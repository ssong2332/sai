/**
 * Anthropic(Claude) provider — 2026-10-23 시험용 옵션으로 붙였다가 같은 날 기본 provider가 됐다(사용자 결정).
 *
 * 🔴 **실제 SDK에 가짜 `fetch`를 주입한다** — 네트워크 없이 SDK가 응답·오류를 실제로 어떻게 해석하는지까지
 *    검증한다(SDK 자체를 대역으로 바꾸면 그 해석을 못 본다). 가짜 fetch를 안 넘기면 실제 요청이 나가므로,
 *    모든 테스트가 `fetchImpl`을 넘기는지 첫 테스트가 잠근다.
 * 🔴 지키는 것: ① `temperature`를 보내지 않는다(2026-10-21부터 400) ② 오류를 기존 사유 표로 분류한다
 *    ③ 폴오버 사슬 **1번**이다(2026-10-23 — 순서 전체는 `failover.unit.test.js`가 잠근다) ④ 사고는 기본으로 끈다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { refine, MemoryCacheStore, FALLBACK_REASONS } from '../src/core/refine/index.js';
import { PROVIDERS } from '../src/core/refine/providers/index.js';
import { FAILOVER_CHAIN } from '../src/core/refine/failover.js';

const BASE_REQUEST = {
  text: '내일 오전까지 리뷰 부탁드립니다',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-12',
};

function goodRaw() {
  return {
    urgency: 'NORMAL',
    urgencyReason: '통상적인 업무 요청입니다.',
    refined: 'Could you review this by tomorrow morning?',
    refinedReason: '요청을 명시적으로 바꿨습니다.',
    preserved: [],
    misreadRisks: [],
    backTranslation: '내일 오전까지 검토해 주실 수 있을까요?',
    detectedIntent: 'normal',
    intentEvidence: null,
    ticket: null,
    appliedGlossary: [],
    unregisteredHonorifics: [],
  };
}

/** Messages API 응답 한 벌. */
function message(content, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

/** SDK가 부를 가짜 fetch — 받은 요청을 기록하고 정해진 응답을 돌려준다. */
function fakeFetch(status, body) {
  const seen = { calls: 0 };
  const impl = async (url, init) => {
    seen.calls += 1;
    seen.url = String(url);
    seen.body = JSON.parse(init.body);
    seen.headers = init.headers;
    return new globalThis.Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  impl.seen = seen;
  return impl;
}

const errorBody = (type) => ({ type: 'error', error: { type, message: 'test' } });

const run = (fetchImpl) =>
  refine(BASE_REQUEST, { apiKey: 'test-key', provider: 'anthropic', cache: new MemoryCacheStore(), fetchImpl });

test('🔴 기본 provider — 폴오버 사슬 1번이다(2026-10-23)', () => {
  assert.ok(PROVIDERS.anthropic, '등록 안 됨');
  assert.equal(PROVIDERS.anthropic.envKey, 'ANTHROPIC_API_KEY');
  assert.equal(PROVIDERS.anthropic.defaultModel, 'claude-haiku-5-5');
  assert.deepEqual(FAILOVER_CHAIN[0], { provider: 'anthropic', model: null }, '사슬 1번이 anthropic(기본 모델)이 아니다');
});

test('정상 응답 — 사고 블록은 건너뛰고 text만, ```json 울타리는 벗긴다', async () => {
  const fetchImpl = fakeFetch(200, message([
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'text', text: '```json\n' + JSON.stringify(goodRaw()) + '\n```' },
  ]));
  const result = await run(fetchImpl);
  assert.equal(fetchImpl.seen.calls, 1, '가짜 fetch를 거치지 않았다 — 실제 요청이 나갔을 수 있다');
  assert.equal(result.fallback, false, result.fallbackDetail);
  assert.equal(result.refined, 'Could you review this by tomorrow morning?');
});

test('🔴 temperature를 보내지 않는다 · 재시도 없음 · 모델 기본값 · Messages 엔드포인트', async () => {
  const fetchImpl = fakeFetch(200, message([{ type: 'text', text: JSON.stringify(goodRaw()) }]));
  await run(fetchImpl);
  assert.match(fetchImpl.seen.url, /\/v1\/messages$/);
  assert.equal('temperature' in fetchImpl.seen.body, false, 'temperature가 실렸다 — 2026-10-21부터 400');
  assert.equal(fetchImpl.seen.body.model, 'claude-haiku-5-5');
  assert.deepEqual(fetchImpl.seen.body.output_config, { effort: 'low' });
});

test('오류 분류 — 기존 사유 표를 따르고, 재시도하지 않는다(호출 1회)', async () => {
  const rows = [
    [401, 'authentication_error', FALLBACK_REASONS.AUTH],
    [429, 'rate_limit_error', FALLBACK_REASONS.QUOTA],
    [400, 'billing_error', FALLBACK_REASONS.QUOTA],
    [400, 'invalid_request_error', FALLBACK_REASONS.ERROR],
    [529, 'overloaded_error', FALLBACK_REASONS.ERROR],
  ];
  for (const [status, type, expected] of rows) {
    const fetchImpl = fakeFetch(status, errorBody(type));
    const result = await run(fetchImpl);
    assert.equal(result.fallback, true);
    assert.equal(result.fallbackReason, expected, `${status} ${type}`);
    assert.equal(fetchImpl.seen.calls, 1, `${status} ${type} — 재시도했다`);
  }
});

test('연결 실패는 error', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const result = await run(fetchImpl);
  assert.equal(result.fallbackReason, FALLBACK_REASONS.ERROR);
});

test('거절·잘림은 invalid — 형식에 맞는 답이 없다', async () => {
  for (const stop of ['refusal', 'max_tokens']) {
    const result = await run(fakeFetch(200, message([], stop)));
    assert.equal(result.fallbackReason, FALLBACK_REASONS.INVALID, stop);
  }
});

test('🔴 사고 스위치 — 기본은 끈다, SAI_ANTHROPIC_THINKING=adaptive일 때만 켠다(2026-10-23 판정표)', async () => {
  const before = process.env.SAI_ANTHROPIC_THINKING;
  const sentThinking = async (value) => {
    if (value === undefined) delete process.env.SAI_ANTHROPIC_THINKING;
    else process.env.SAI_ANTHROPIC_THINKING = value;
    const fetchImpl = fakeFetch(200, message([{ type: 'text', text: JSON.stringify(goodRaw()) }]));
    await run(fetchImpl);
    return 'thinking' in fetchImpl.seen.body ? fetchImpl.seen.body.thinking : '(생략)';
  };
  try {
    // [환경변수 값, 보내는 것]
    const rows = [
      [undefined, { type: 'disabled' }], // 기본(운영)
      ['disabled', { type: 'disabled' }],
      ['enabled', { type: 'disabled' }], // 🔴 모르는 값은 끈다 — 오타로 비용·지연이 3배가 되지 않게
      ['adaptive', '(생략)'], //            실험 전용 — 모델 기본(L30 「켬」 조건)
    ];
    for (const [value, expected] of rows) {
      assert.deepEqual(await sentThinking(value), expected, `SAI_ANTHROPIC_THINKING=${value}`);
    }
  } finally {
    if (before === undefined) delete process.env.SAI_ANTHROPIC_THINKING;
    else process.env.SAI_ANTHROPIC_THINKING = before;
  }
});

test('🔴 사고 스위치 — `deps.thinking`을 넘기면 그 값이 이기고 process.env는 안 본다, 생략하면 process.env(Node 경로 불변) (2026-10-24 L33)', async () => {
  const before = process.env.SAI_ANTHROPIC_THINKING;
  const sentThinking = async (envValue, option) => {
    if (envValue === undefined) delete process.env.SAI_ANTHROPIC_THINKING;
    else process.env.SAI_ANTHROPIC_THINKING = envValue;
    const fetchImpl = fakeFetch(200, message([{ type: 'text', text: JSON.stringify(goodRaw()) }]));
    await refine(BASE_REQUEST, {
      apiKey: 'test-key', provider: 'anthropic', cache: new MemoryCacheStore(), fetchImpl,
      ...(option === 'omit' ? {} : { thinking: option }),
    });
    return 'thinking' in fetchImpl.seen.body ? fetchImpl.seen.body.thinking : '(생략)';
  };
  try {
    // [환경변수 값, deps.thinking('omit' = 안 넘김), 보내는 것]
    const rows = [
      ['adaptive', 'disabled', { type: 'disabled' }], // 🔴 명시가 이긴다 — 남은 환경변수가 켜지 않는다
      [undefined, 'adaptive', '(생략)'], //            명시 켬
      ['adaptive', 'enabled', { type: 'disabled' }], // 모르는 값은 끔(오타)
      ['adaptive', null, { type: 'disabled' }], //     null도 「넘김」 — 끔
      ['adaptive', undefined, '(생략)'], //            undefined = 안 넘김 → process.env
      ['adaptive', 'omit', '(생략)'], //               Node 경로(프록시·Functions·회귀 러너)
      [undefined, 'omit', { type: 'disabled' }],
    ];
    for (const [envValue, option, expected] of rows) {
      assert.deepEqual(await sentThinking(envValue, option), expected, `env=${envValue} option=${option}`);
    }
  } finally {
    if (before === undefined) delete process.env.SAI_ANTHROPIC_THINKING;
    else process.env.SAI_ANTHROPIC_THINKING = before;
  }
});

test('실사용 토큰 누계 — 응답 usage를 숫자만 더한다(L30 비용 측정)', async () => {
  const { anthropicUsage } = await import('../src/core/refine/providers/anthropic.js');
  const before = { ...anthropicUsage };
  await run(fakeFetch(200, message([{ type: 'text', text: JSON.stringify(goodRaw()) }])));
  assert.equal(anthropicUsage.calls, before.calls + 1);
  assert.equal(anthropicUsage.input, before.input + 10);
  assert.equal(anthropicUsage.output, before.output + 10);
});
