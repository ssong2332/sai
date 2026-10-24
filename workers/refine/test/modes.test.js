/**
 * Worker 나머지 mode(decode·decisions·reply) — 2026-10-24 이식(L33). 그전에는 501이었다.
 * 🔴 네트워크 없음: 토큰은 로컬 키, provider는 가짜 fetch(`fakeAnthropicFetch`·`fakeMultiFetch`).
 * 🔴 「Functions와 같은 모양」은 **같은 코어를 같은 가짜 응답으로 직접 부른 결과**와 deepEqual로 본다 —
 *    Functions `MODES[*].run`은 코어 결과를 그대로 `res.json`에 싣는다(`functions/index.js`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { decode } from '../../../src/core/decode/index.js';
import { summarizeDecisions } from '../../../src/core/decisions/index.js';
import { reply } from '../../../src/core/reply/index.js';
import { createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import {
  BASE_BODY,
  CHAIN_ENV,
  EXT_ORIGIN,
  TEST_ENV,
  captureLogger,
  fakeAnthropicFetch,
  fakeMultiFetch,
  makeKeys,
  refineRequest,
  signIdToken,
} from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);

/** mode별 요청·가짜 모델 응답·본문 탐지용 고유 문자열. 합성 데이터 — 코어 단위 테스트 픽스처와 같은 모양. */
const CASES = {
  decode: {
    body: {
      mode: 'decode',
      text: 'Thanks for the update ZRDEC_4417! I have a few minor comments — maybe we could revisit the overall approach.',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
    },
    raw: {
      literalTranslation: '업데이트 고마워요 ZRDEC_OUT_1! 사소한 코멘트가 몇 개 있어요.',
      actualIntent: '접근 방식 재검토를 요구하고 있을 가능성이 높습니다.',
      intentEvidence: '"a few minor comments" — 완곡한 화법',
      surfaceUrgency: 'LOW',
      actualUrgency: 'CRITICAL',
      urgencyReason: '표면상 가볍지만 접근 방식 재검토라는 실질 요구가 있습니다.',
      urgencyEvidence: 'revisit the overall approach',
      requiredActions: ['접근 방식 재검토안 준비', '1차 회신'],
    },
    secrets: ['ZRDEC_4417', 'ZRDEC_OUT_1'],
    run: decode,
    check: (out) => {
      assert.equal(out.fallback, false);
      assert.equal(out.actualUrgency, 'CRITICAL');
      assert.equal(out.cached, false);
    },
  },
  decisions: {
    body: {
      mode: 'decisions',
      text: [
        'Miguel: Can we ship the rollout on Friday? ZRDCS_9921',
        'Jin: Yes, agreed — Friday works. I will own the deploy.',
        'Miguel: I still need sign-off from my director on the pricing change.',
      ].join('\n'),
    },
    raw: {
      decisions: [
        {
          decision: '롤아웃을 금요일에 배포한다 ZRDCS_OUT_2',
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
    },
    secrets: ['ZRDCS_9921', 'ZRDCS_OUT_2', 'Miguel'],
    run: summarizeDecisions,
    check: (out) => {
      assert.equal(out.fallback, false);
      assert.equal(out.decisionCount, 2);
      assert.equal(out.cached, false);
    },
  },
  reply: {
    body: {
      mode: 'reply',
      text: 'Could you review PR #482? We need it before the release. ZRREP_3308',
      intent: 'accept',
      sourceLanguage: 'en',
      targetLanguage: 'ko',
    },
    raw: { draft: '네, PR #482 검토하겠습니다 ZRREP_OUT_3', placeholderNote: '' },
    secrets: ['ZRREP_3308', 'ZRREP_OUT_3'],
    run: reply,
    check: (out) => {
      assert.equal(out.fallback, false);
      assert.equal(out.draft, '네, PR #482 검토하겠습니다 ZRREP_OUT_3');
      assert.equal(out.cached, false);
    },
  },
};

function setup({ fetchImpl, usageStore = createMemoryUsageStore() } = {}) {
  const logger = captureLogger();
  const handle = createHandler({ jwks: keys.jwks, fetchImpl, usageStore, cache: new MemoryCacheStore(), logger });
  return { handle, logger, fetchImpl, usageStore };
}

for (const [modeName, c] of Object.entries(CASES)) {
  test(`${modeName} — 200, Functions와 같은 응답(같은 코어 직접 호출과 deepEqual), 성공 로그 없음, 지표 mode=${modeName}`, async () => {
    const { handle, fetchImpl, logger, usageStore } = setup({ fetchImpl: fakeAnthropicFetch(c.raw) });
    const res = await handle(refineRequest(token, c.body), TEST_ENV);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), EXT_ORIGIN);
    const body = await res.json();
    c.check(body);

    // Functions 경로 = 같은 코어를 같은 가짜 응답으로 부른 결과(Functions는 결과를 그대로 싣는다).
    const direct = await c.run(c.body, {
      apiKey: 'x',
      provider: 'anthropic',
      cache: new MemoryCacheStore(),
      thinking: 'disabled',
      fetchImpl: fakeAnthropicFetch(c.raw),
    });
    assert.deepEqual(body, JSON.parse(JSON.stringify(direct)));

    assert.equal(fetchImpl.seen.calls, 1);
    assert.match(fetchImpl.seen.urls[0], /^https:\/\/api\.anthropic\.com\/v1\/messages/);
    assert.deepEqual(fetchImpl.seen.bodies[0].thinking, { type: 'disabled' }, '🔴 사고 끔이 이 mode에도 걸려야 한다');
    assert.deepEqual(logger.lines, [], '성공이 로그를 남겼다');
    assert.equal(usageStore.requests.length, 1);
    assert.equal(usageStore.requests[0].mode, modeName);
    assert.deepEqual(Object.keys(usageStore.requests[0]).sort(), ['fallback', 'fallbackReason', 'latencyMs', 'mode']);

    // 두 번째는 캐시 — provider를 다시 부르지 않는다.
    const again = await (await handle(refineRequest(token, c.body), TEST_ENV)).json();
    assert.equal(again.cached, true);
    assert.equal(fetchImpl.seen.calls, 1);
  });

  test(`${modeName} — anthropic 429 → groq로 폴오버, providerUsed=groq`, async () => {
    const fetchImpl = fakeMultiFetch({ anthropic: 429 }, c.raw);
    const { handle, logger } = setup({ fetchImpl });
    const res = await handle(refineRequest(token, c.body), CHAIN_ENV);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.fallback, false);
    assert.equal(body.providerUsed, 'groq');
    assert.equal(body.modelUsed, null);
    assert.deepEqual(fetchImpl.seen.order, ['anthropic', 'groq']);
    // 폴백 1줄(anthropic quota) + 폴오버 1줄. 태그는 mode 이름.
    assert.equal(logger.lines.length, 2, logger.lines.join(' | '));
    assert.ok(logger.lines.every((line) => line.startsWith(`[${modeName}] `)), logger.lines.join(' | '));
    assert.match(logger.lines[0], new RegExp(`^\\[${modeName}\\] provider=anthropic .* cache=miss fallback=quota \\d+ms$`));
    assert.match(logger.lines[1], /anthropic quota — groq로 다시 시도합니다\.$/);
  });

  test(`${modeName} — 명시 provider는 폴오버하지 않는다(429 → 폴백 quota)`, async () => {
    const fetchImpl = fakeMultiFetch({ anthropic: 429 }, c.raw);
    const { handle } = setup({ fetchImpl });
    const res = await handle(refineRequest(token, { ...c.body, provider: 'anthropic' }), CHAIN_ENV);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.fallback, true);
    assert.equal(body.fallbackReason, 'quota');
    assert.deepEqual(fetchImpl.seen.order, ['anthropic']);
  });

  test(`🔴 ${modeName} — Zero Retention: 성공·폴오버·사슬 전체 실패·400 어느 로그에도 본문·출력·토큰·키가 없다`, async () => {
    const scenarios = [
      { fetchImpl: fakeAnthropicFetch(c.raw), env: TEST_ENV },
      { fetchImpl: fakeMultiFetch({ anthropic: 429 }, c.raw), env: CHAIN_ENV },
      { fetchImpl: fakeMultiFetch({ anthropic: 429, groq: 429 }, c.raw), env: CHAIN_ENV },
    ];
    const all = [];
    for (const { fetchImpl, env } of scenarios) {
      const { handle, logger } = setup({ fetchImpl });
      await handle(refineRequest(token, { ...c.body, bypassCache: true }), env);
      // 400 경로 — 코어가 거절하는 요청(빈 text). 메시지는 우리 문구여야 한다.
      const bad = await handle(refineRequest(token, { ...c.body, text: '' }), env);
      assert.equal(bad.status, 400);
      all.push(...logger.lines);
    }
    assert.ok(all.length > 0, '로그가 하나도 없으면 검사가 무의미하다');
    const joined = all.join('\n');
    for (const needle of [...c.secrets, token, TEST_ENV.ANTHROPIC_API_KEY, CHAIN_ENV.GROQ_API_KEY]) {
      assert.equal(joined.includes(needle), false, `로그에 남았다: ${needle.slice(0, 12)}…`);
    }
  });

  test(`🔴 ${modeName} — 요청 경로는 globalThis.process를 읽지 않는다`, async () => {
    const { handle } = setup({ fetchImpl: fakeAnthropicFetch(c.raw) });
    const realProcess = globalThis.process;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
    let reads = 0;
    Object.defineProperty(globalThis, 'process', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      get() {
        reads += 1;
        return realProcess;
      },
      set(value) {
        Object.defineProperty(globalThis, 'process', { ...descriptor, value });
      },
    });
    let status;
    try {
      status = (await handle(refineRequest(token, { ...c.body, bypassCache: true }), TEST_ENV)).status;
    } finally {
      Object.defineProperty(globalThis, 'process', descriptor);
    }
    assert.equal(status, 200);
    assert.equal(reads, 0, `요청 처리 중 globalThis.process를 ${reads}번 읽었다`);
  });
}

test('같은 text라도 decode 결과를 decisions가 재사용하지 않는다(mode별 캐시)', async () => {
  const fetchImpl = fakeMultiFetch({}, { ...CASES.decode.raw, ...CASES.decisions.raw });
  const { handle } = setup({ fetchImpl });
  const text = CASES.decode.body.text;
  await handle(refineRequest(token, { ...CASES.decode.body, text }), TEST_ENV);
  const res = await (await handle(refineRequest(token, { mode: 'decisions', text }), TEST_ENV)).json();
  assert.equal(res.cached, false);
  assert.equal(fetchImpl.seen.calls, 2);
});

test('모르는 mode·mode 없음 → refine으로 처리(기존 서버와 같다), 지표 mode=refine', async () => {
  for (const mode of ['translate', undefined, 42]) {
    const fetchImpl = fakeAnthropicFetch();
    const { handle, usageStore } = setup({ fetchImpl });
    const res = await handle(refineRequest(token, { ...BASE_BODY, ...(mode === undefined ? {} : { mode }) }), TEST_ENV);
    assert.equal(res.status, 200, `mode=${mode}`);
    const body = await res.json();
    assert.equal(body.refined, 'Could you review this by tomorrow morning?');
    assert.equal(usageStore.requests[0].mode, 'refine');
  }
});

test('잘못된 요청 → 400 + 코어 문구, 지표 rejected·mode 이름, LLM 안 부름', async () => {
  const fetchImpl = fakeAnthropicFetch();
  const { handle, usageStore } = setup({ fetchImpl });
  const res = await handle(refineRequest(token, { ...CASES.reply.body, intent: 'threaten' }), TEST_ENV);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /^intent must be one of /);
  assert.equal(fetchImpl.seen.calls, 0);
  assert.equal(usageStore.requests[0].mode, 'reply');
  assert.equal(usageStore.requests[0].rejected, true);
});
