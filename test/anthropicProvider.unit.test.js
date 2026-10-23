/**
 * Anthropic(Claude) provider — 시험용 옵션(2026-10-23).
 *
 * 🔴 **실제 SDK에 가짜 `fetch`를 주입한다** — 네트워크 없이 SDK가 응답·오류를 실제로 어떻게 해석하는지까지
 *    검증한다(SDK 자체를 대역으로 바꾸면 그 해석을 못 본다). 가짜 fetch를 안 넘기면 실제 요청이 나가므로,
 *    모든 테스트가 `fetchImpl`을 넘기는지 첫 테스트가 잠근다.
 * 🔴 지키는 것: ① `temperature`를 보내지 않는다(2026-10-21부터 400) ② 오류를 기존 사유 표로 분류한다
 *    ③ 기본 provider 순서·폴오버 사슬에 끼어들지 않는다(옵션일 뿐).
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

test('🔴 기본 provider 순서·폴오버 사슬에 끼어들지 않는다 — 옵션으로만 등록', () => {
  assert.ok(PROVIDERS.anthropic, '등록 안 됨');
  assert.equal(PROVIDERS.anthropic.envKey, 'ANTHROPIC_API_KEY');
  assert.equal(PROVIDERS.anthropic.defaultModel, 'claude-haiku-5-5');
  assert.ok(!FAILOVER_CHAIN.some((step) => step.provider === 'anthropic'), '사슬에 들어갔다');
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

test('사고 끄기 스위치 — SAI_ANTHROPIC_THINKING=disabled일 때만 thinking을 끈다(기본은 보내지 않음)', async () => {
  const before = process.env.SAI_ANTHROPIC_THINKING;
  try {
    delete process.env.SAI_ANTHROPIC_THINKING;
    const on = fakeFetch(200, message([{ type: 'text', text: JSON.stringify(goodRaw()) }]));
    await run(on);
    assert.equal('thinking' in on.seen.body, false);

    process.env.SAI_ANTHROPIC_THINKING = 'disabled';
    const off = fakeFetch(200, message([{ type: 'text', text: JSON.stringify(goodRaw()) }]));
    await run(off);
    assert.deepEqual(off.seen.body.thinking, { type: 'disabled' });
  } finally {
    if (before === undefined) delete process.env.SAI_ANTHROPIC_THINKING;
    else process.env.SAI_ANTHROPIC_THINKING = before;
  }
});
