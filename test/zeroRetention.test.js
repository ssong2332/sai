/**
 * S08 — Zero Retention 준수 **실행 검증** (Spec 필수 5 · audit 7).
 *
 * 🔴 이 파일의 존재 이유: Zero Retention은 "리뷰했다"로는 지킬 수 없다. 로거에 필드 하나를
 *    더하거나 에러 메시지에 원문을 끼워 넣는 한 줄이면 조용히 깨지고, 아무 테스트도 실패하지
 *    않는다. 그래서 **본문이 밖으로 나가는 모든 경계에 감시탑을 세운다.**
 *
 * 검사 대상 경계 (판정표):
 *   ① logger가 받는 이벤트         — Functions 로그로 그대로 나간다
 *   ② 에러 객체의 message/stack    — 로그·응답으로 나간다
 *   ③ 캐시 **키**                  — 키는 저장·비교에 쓰인다(해시여야 한다)
 *   ④ 클라이언트 storage 기록값    — chrome.storage.local에 영속된다
 *
 * 허용되는 것: 프로세스 메모리 안의 본문(처리하려면 불가피) · 카운트/수치/enum/불리언.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { refine } from '../src/core/refine/index.js';
import { decode } from '../src/core/decode/index.js';
import { summarizeDecisions } from '../src/core/decisions/index.js';
import { computeCacheKey } from '../src/core/refine/cache.js';

/**
 * 🔴 본문 추적용 감시 문자열. 흔한 단어를 쓰면 우연한 일치로 테스트가 거짓 실패한다 —
 *    실제 텍스트에 절대 나오지 않을 고유 토큰을 쓴다.
 */
const SENTINEL = 'ZRSENTINELQX7';
const SECRET_BODY = `내일까지 ${SENTINEL} 건을 처리해 주세요. 계약 금액은 ${SENTINEL}9만원입니다.`;

/** 본문 조각이 섞였는지 본다. 문자열화해서 어떤 중첩 구조든 뚫고 검사한다. */
function assertNoBody(value, where) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  assert.ok(
    !serialized.includes(SENTINEL),
    `🔴 Zero Retention 위반 — ${where}에 본문 조각이 들어갔다: ${serialized}`,
  );
}

function llmResponse(overrides = {}) {
  return {
    urgency: 'NORMAL',
    urgencyReason: '통상적인 업무 요청입니다.',
    refined: 'Please handle this by tomorrow.',
    refinedReason: '요청을 명시적으로 바꿨습니다.',
    preserved: [],
    misreadRisks: [],
    backTranslation: '내일까지 처리해 주세요.',
    detectedIntent: 'normal',
    intentEvidence: null,
    ticket: null,
    appliedGlossary: [],
    unregisteredHonorifics: [],
    ...overrides,
  };
}

function stubGemini(raw) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(raw) }] } }],
    }),
  });
}

const BASE = {
  text: SECRET_BODY,
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-13',
};

/* ── ① logger 경계 — Functions 로그로 그대로 나가는 값 ─────────────────── */

test('🔴 정상 경로: logger가 받는 이벤트에 본문이 없다', async () => {
  const events = [];
  await refine(BASE, {
    apiKey: 'k',
    provider: 'gemini',
    fetchImpl: stubGemini(llmResponse()),
    logger: (event) => events.push(event),
  });
  assert.ok(events.length > 0, 'logger가 최소 1회 불려야 의미 있는 검사가 된다');
  for (const event of events) assertNoBody(event, 'refine logger 이벤트');
});

test('🔴 캐시 히트 경로에서도 logger에 본문이 없다', async () => {
  const events = [];
  const deps = {
    apiKey: 'k',
    provider: 'gemini',
    fetchImpl: stubGemini(llmResponse()),
    logger: (event) => events.push(event),
  };
  await refine(BASE, deps);
  const second = await refine(BASE, deps);
  assert.equal(second.cached, true, '두 번째 호출은 캐시 히트여야 이 경로가 검사된다');
  for (const event of events) assertNoBody(event, 'refine 캐시 히트 logger 이벤트');
});

test('🔴 LLM 응답이 스키마에 안 맞는 폴백 경로에서도 logger에 본문이 없다', async () => {
  const events = [];
  await refine(BASE, {
    apiKey: 'k',
    provider: 'gemini',
    // refined 누락 → 스키마 위반 → issues가 logger로 간다
    fetchImpl: stubGemini(llmResponse({ refined: '' })),
    logger: (event) => events.push(event),
  });
  for (const event of events) assertNoBody(event, 'refine 스키마 폴백 logger 이벤트');
});

test('🔴 LLM 호출 자체가 실패한 폴백 경로에서도 logger에 본문이 없다', async () => {
  const events = [];
  await refine(BASE, {
    apiKey: 'k',
    provider: 'gemini',
    fetchImpl: async () => {
      throw new Error(`network exploded while sending ${SECRET_BODY}`);
    },
    logger: (event) => events.push(event),
  });
  for (const event of events) assertNoBody(event, 'refine 네트워크 실패 logger 이벤트');
});

test('🔴 decode 경로의 logger에도 본문이 없다', async () => {
  const events = [];
  await decode(
    { text: SECRET_BODY, sourceLanguage: 'en', targetLanguage: 'ko' },
    {
      apiKey: 'k',
      provider: 'gemini',
      fetchImpl: stubGemini({
        literalTranslation: '내일까지 처리해 주세요.',
        actualIntent: '',
        intentEvidence: '',
        surfaceUrgency: 'NORMAL',
        actualUrgency: 'NORMAL',
        requiredActions: [],
      }),
      logger: (event) => events.push(event),
    },
  );
  assert.ok(events.length > 0);
  for (const event of events) assertNoBody(event, 'decode logger 이벤트');
});

test('🔴 decisions 경로의 logger에도 본문이 없다 (S25)', async () => {
  const events = [];
  await summarizeDecisions(
    { text: SECRET_BODY },
    {
      apiKey: 'k',
      provider: 'gemini',
      fetchImpl: stubGemini({
        // 🔴 결정 문구·담당자에 감시 토큰을 심는다 — 모델 출력이 로그로 새는 경로를 본다.
        decisions: [
          {
            decision: `${SENTINEL} 건을 내일까지 처리한다`,
            owner: SENTINEL,
            dueDate: '내일',
            authorityStatus: '확정',
            authorityEvidence: `"${SENTINEL}"`,
          },
        ],
      }),
      logger: (event) => events.push(event),
    },
  );
  assert.ok(events.length > 0);
  for (const event of events) assertNoBody(event, 'decisions logger 이벤트');
});

test('🔴 decisions 폴백 경로의 logger에도 본문이 없다 (S25)', async () => {
  const events = [];
  await summarizeDecisions(
    { text: SECRET_BODY },
    {
      apiKey: 'k',
      provider: 'gemini',
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
      logger: (event) => events.push(event),
    },
  );
  assert.ok(events.length > 0);
  for (const event of events) assertNoBody(event, 'decisions 폴백 logger 이벤트');
});

/* ── ② 반환된 폴백 결과 — 화면·로그 어디로든 갈 수 있다 ───────────────── */

test('🔴 폴백 결과의 사유·안내 문구에 본문이 섞이지 않는다', async () => {
  const result = await refine(BASE, {
    apiKey: 'k',
    provider: 'gemini',
    fetchImpl: async () => {
      throw new Error(`upstream said: ${SECRET_BODY}`);
    },
    logger: () => {},
  });
  // 🔴 refined/backTranslation은 폴백에서 우리 문구이거나 null이어야 한다 —
  //    상류 에러 문자열을 그대로 실어 나르면 본문이 화면까지 온다.
  assertNoBody(result.fallbackReason, '폴백 사유');
  assertNoBody(result.urgencyNotice, '긴급도 실패 안내');
  assertNoBody(result.refined, '폴백 refined');
});

/* ── ③ 캐시 키 — 저장·비교에 쓰이므로 원문이면 안 된다 ────────────────── */

test('🔴 캐시 키는 해시이며 원문을 담지 않는다', () => {
  const key = computeCacheKey({
    model: 'gemini:x',
    promptVersion: 'v1',
    payload: { text: SECRET_BODY },
  });
  assertNoBody(key, '캐시 키');
  assert.match(key, /^[0-9a-f]{64}$/, 'sha256 16진 해시여야 한다');
});

test('본문이 다르면 캐시 키도 다르다 — 해시가 실제로 입력을 반영한다', () => {
  const make = (text) =>
    computeCacheKey({ model: 'm', promptVersion: 'v1', payload: { text } });
  assert.notEqual(make('문장 A'), make('문장 B'));
});

/* ── ④ 클라이언트 storage — chrome.storage.local에 영속된다 ───────────── */

test('🔴 학습 기록(recordEdit)은 본문을 저장하지 않는다', async () => {
  const { recordEdit, getLearnedCounts } = await import('../src/lib/profile.js');

  // 사과 표현 제거 = 판정표 A에 걸리는 수정이라 실제로 기록이 일어난다.
  await recordEdit(`Sorry, sorry — ${SECRET_BODY}`, SECRET_BODY);
  const counts = await getLearnedCounts();

  assert.ok(Object.keys(counts).length > 0, '기록이 실제로 일어나야 의미 있는 검사가 된다');
  assertNoBody(counts, '학습 기록 저장값');
  // 저장되는 값은 숫자뿐이어야 한다.
  for (const value of Object.values(counts)) {
    assert.equal(typeof value, 'number', '학습 저장값은 횟수(숫자)만 허용된다');
  }
});

test('🔴 분류 결과 자체에도 본문이 없다', async () => {
  const { classifyEdit } = await import('../src/core/profile/diff.js');
  const outcome = classifyEdit(`Sorry, sorry — ${SECRET_BODY}`, SECRET_BODY);
  assertNoBody(outcome, 'classifyEdit 반환값');
});

test('🔴 민감정보 가드의 요약·탐지 결과에 원문 값이 없다', async () => {
  const { detectSensitive, summarize } = await import('../src/content/sensitiveGuard.js');
  const withSecret = `내 키는 sk-abcdefghijklmnopqrstuvwxyz012345 이고 ${SENTINEL} 입니다`;
  const { findings } = detectSensitive(withSecret);
  assertNoBody(findings, '민감정보 탐지 결과');
  assertNoBody(summarize(findings), '민감정보 요약 문구');
});
