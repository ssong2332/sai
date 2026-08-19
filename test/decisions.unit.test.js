/**
 * 결정사항 자동 요약 단위 테스트 (S25 / Spec 부가 7). LLM은 스텁 — API 키 불필요.
 *
 * 이 스위트가 지키는 불변식(schema.js 판정표):
 *   - 근거 없는 담당자·기한을 만들지 않는다 (owner/dueDate → null)
 *   - 근거 없이 권한 상태를 단정하지 않는다 (→ 불명으로 강등)
 *   - "결정 없음"과 "읽지 못함"을 섞지 않는다 (`decisions: []` vs `fallback: true`)
 *   - 로그에 본문이 새지 않는다 (Spec 필수 5)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeDecisions,
  DecisionsRequestError,
  DECISIONS_FALLBACK_REASONS,
  MAX_THREAD_CHARS,
  normalizeDecisionsResponse,
} from '../src/core/decisions/index.js';
import { MemoryCacheStore } from '../src/core/refine/cache.js';

const BASE_REQUEST = {
  text: [
    'Miguel: Can we ship the rollout on Friday?',
    'Jin: Yes, agreed — Friday works. I will own the deploy.',
    'Miguel: I still need sign-off from my director on the pricing change.',
  ].join('\n'),
};

function goodRaw(overrides = {}) {
  return {
    decisions: [
      {
        decision: '롤아웃을 금요일에 배포한다',
        owner: 'Jin',
        dueDate: 'Friday',
        authorityStatus: '확정',
        authorityEvidence: '"Yes, agreed — Friday works."',
      },
      {
        decision: '가격 변경안을 적용한다',
        owner: 'Miguel',
        dueDate: null,
        authorityStatus: '내부 승인 필요',
        authorityEvidence: '"I still need sign-off from my director"',
      },
    ],
    ...overrides,
  };
}

function stubFetch(raw, { status = 200, errorCode } = {}) {
  const calls = { count: 0 };
  const impl = async () => {
    calls.count += 1;
    if (status !== 200) {
      return { ok: false, status, json: async () => ({ error: { code: errorCode } }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
    };
  };
  impl.calls = calls;
  return impl;
}

function deps(fetchImpl, extra = {}) {
  return { apiKey: 'test-key', cache: new MemoryCacheStore(), fetchImpl, ...extra };
}

/* ── 정상 추출 ────────────────────────────────────────────────────────── */

test('결정·담당자·기한·권한 상태를 행 단위로 돌려준다', async () => {
  const result = await summarizeDecisions(BASE_REQUEST, deps(stubFetch(goodRaw())));

  assert.equal(result.fallback, false);
  assert.equal(result.decisionCount, 2);
  assert.equal(result.decisions[0].decision, '롤아웃을 금요일에 배포한다');
  assert.equal(result.decisions[0].owner, 'Jin');
  assert.equal(result.decisions[0].dueDate, 'Friday');
  assert.equal(result.decisions[0].authorityStatus, '확정');
});

test('owner 또는 dueDate가 비면 미확정으로 집계한다 (인덱스만 — 본문 복제 없음)', async () => {
  const result = await summarizeDecisions(BASE_REQUEST, deps(stubFetch(goodRaw())));

  // 2번째 행은 dueDate가 null이다.
  assert.deepEqual(result.unresolvedIndexes, [1]);
  assert.equal(result.unresolvedCount, 1);
});

/* ── 지어내기 방지 (c7 AC-020 / AC-050) ──────────────────────────────── */

test('owner·dueDate가 문자열이 아니면 null로 만든다 — 그럴듯한 값을 지어내지 않는다', () => {
  const { result } = normalizeDecisionsResponse({
    decisions: [
      { decision: 'A안으로 간다', owner: '', dueDate: '   ', authorityStatus: '불명' },
      { decision: 'B안은 보류', owner: 42, dueDate: {}, authorityStatus: '불명' },
    ],
  });

  assert.equal(result.decisions[0].owner, null);
  assert.equal(result.decisions[0].dueDate, null);
  assert.equal(result.decisions[1].owner, null);
  assert.equal(result.decisions[1].dueDate, null);
});

test('🔴 근거 없이 「확정」이라고 하면 「불명」으로 강등한다 — 이 기능의 최악 실패를 막는 가드', () => {
  const { result } = normalizeDecisionsResponse({
    decisions: [
      { decision: '가격을 올린다', owner: 'Ana', dueDate: null, authorityStatus: '확정', authorityEvidence: null },
      { decision: '일정을 미룬다', owner: null, dueDate: null, authorityStatus: '내부 승인 필요', authorityEvidence: '  ' },
    ],
  });

  assert.equal(result.decisions[0].authorityStatus, '불명');
  assert.equal(result.decisions[0].authorityEvidence, null);
  assert.equal(result.decisions[1].authorityStatus, '불명');
  assert.equal(result.unknownAuthorityCount, 2);
});

test('「불명」인데 근거가 붙어 있으면 그 근거를 버린다 — 무엇에 대한 근거인지 알 수 없다', () => {
  const { result } = normalizeDecisionsResponse({
    decisions: [
      { decision: '검토한다', owner: null, dueDate: null, authorityStatus: '불명', authorityEvidence: '아무 문장' },
    ],
  });

  assert.equal(result.decisions[0].authorityEvidence, null);
});

test('권한 상태가 네 값 밖이면 「불명」으로 떨어뜨린다', () => {
  const { result } = normalizeDecisionsResponse({
    decisions: [
      { decision: 'X', owner: null, dueDate: null, authorityStatus: 'APPROVED', authorityEvidence: '근거 문장' },
    ],
  });

  assert.equal(result.decisions[0].authorityStatus, '불명');
});

test('decision 문구가 빈 행은 통째로 버린다 — 빈 행이 표에 뜨지 않는다', () => {
  const { result, issues } = normalizeDecisionsResponse({
    decisions: [
      { decision: '   ', owner: 'Jin', dueDate: 'Friday', authorityStatus: '확정', authorityEvidence: 'x' },
      { decision: '유효한 결정', owner: null, dueDate: null, authorityStatus: '불명' },
      null,
    ],
  });

  assert.equal(result.decisionCount, 1);
  assert.equal(result.decisions[0].decision, '유효한 결정');
  assert.ok(issues.includes('decisions:dropped-invalid-items'));
});

/* ── "결정 없음" vs "읽지 못함" ──────────────────────────────────────── */

test('결정이 없는 스레드는 빈 배열이 정상 응답이다 — 폴백이 아니다', async () => {
  const result = await summarizeDecisions(BASE_REQUEST, deps(stubFetch({ decisions: [] })));

  assert.equal(result.fallback, false);
  assert.equal(result.decisionCount, 0);
  assert.deepEqual(result.decisions, []);
});

test('LLM 실패는 빈 표 + fallback:true로 흡수한다 — 결정을 지어내지 않는다', async () => {
  const result = await summarizeDecisions(
    BASE_REQUEST,
    deps(stubFetch(null, { status: 429, errorCode: 'insufficient_quota' })),
  );

  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, DECISIONS_FALLBACK_REASONS.QUOTA);
  assert.deepEqual(result.decisions, []);
  assert.match(result.fallbackNotice, /사용량이 소진/);
});

test('decisions가 배열이 아니면 폴백한다', async () => {
  const result = await summarizeDecisions(
    BASE_REQUEST,
    deps(stubFetch({ decisions: '롤아웃 배포' })),
  );

  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, DECISIONS_FALLBACK_REASONS.INVALID);
});

/* ── 입력 검증·상한 ──────────────────────────────────────────────────── */

test('빈 텍스트는 요청 오류다', async () => {
  await assert.rejects(
    () => summarizeDecisions({ text: '   ' }, deps(stubFetch(goodRaw()))),
    DecisionsRequestError,
  );
});

test('상한을 넘으면 앞을 자르고 truncated로 알린다 — 결정은 대화 끝에 있다', async () => {
  const tail = '\nJin: 최종 결정은 A안입니다.';
  const long = 'x'.repeat(MAX_THREAD_CHARS) + tail;
  const fetchImpl = stubFetch(goodRaw());
  const result = await summarizeDecisions({ text: long }, deps(fetchImpl));

  assert.equal(result.truncated, true);
  assert.equal(result.fallback, false);
});

test('상한 이하면 truncated는 false다', async () => {
  const result = await summarizeDecisions(BASE_REQUEST, deps(stubFetch(goodRaw())));
  assert.equal(result.truncated, false);
});

/* ── 캐시 ────────────────────────────────────────────────────────────── */

test('같은 스레드 재요청은 캐시로 돌려주고 LLM을 다시 부르지 않는다', async () => {
  const fetchImpl = stubFetch(goodRaw());
  const cache = new MemoryCacheStore();

  const first = await summarizeDecisions(BASE_REQUEST, deps(fetchImpl, { cache }));
  const second = await summarizeDecisions(BASE_REQUEST, deps(fetchImpl, { cache }));

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(fetchImpl.calls.count, 1);
});

/* ── Zero Retention (Spec 필수 5) ────────────────────────────────────── */

test('🔴 로그에 결정 문구·담당자 이름이 한 조각도 없다', async () => {
  const events = [];
  await summarizeDecisions(BASE_REQUEST, deps(stubFetch(goodRaw()), { logger: (e) => events.push(e) }));

  const dumped = JSON.stringify(events);
  for (const leak of ['롤아웃', 'Jin', 'Miguel', 'Friday', 'sign-off', '가격 변경']) {
    assert.equal(dumped.includes(leak), false, `로그에 "${leak}"이 새어 나갔다`);
  }
  // 대신 수치는 있어야 한다 — 안 남기는 것과 못 세는 것은 다르다.
  assert.equal(events[0].decisionCount, 2);
  assert.equal(events[0].unresolvedCount, 1);
});

test('🔴 폴백 로그에도 본문이 없다', async () => {
  const events = [];
  await summarizeDecisions(
    BASE_REQUEST,
    deps(stubFetch(null, { status: 500 }), { logger: (e) => events.push(e) }),
  );

  const dumped = JSON.stringify(events);
  assert.equal(dumped.includes('Miguel'), false);
  assert.equal(events[0].fallback, true);
});
