/**
 * Worker의 SDK 대역(`src/anthropicFetch.js`) — 코어 `providers/anthropic.js`를 **그대로** 태워서 본다 (2026-10-23 L33).
 *
 * 🔴 대역만 따로 부르지 않고 **코어 `refine()` → `callAnthropic` → (alias) 대역** 순으로 부른다 — 배포 번들과 같은
 *    경로다(`wrangler.toml` `[alias]` ↔ Node에서는 `test/sdkAlias.mjs`). 그래서 이 표가 지키는 것은
 *    「대역이 진짜 SDK 자리에 들어가도 코어의 오류 분류·본문·사고 스위치가 그대로다」이다.
 * 🔴 네트워크 없음 — 모든 호출이 가짜 fetch를 거치는지 `seen.calls`로 확인한다.
 *
 * | 시험 | 기대 | 근거 |
 * |---|---|---|
 * | alias가 걸렸다 | `import('@anthropic-ai/sdk')` = 대역 | 안 걸리면 진짜 SDK를 시험하게 된다 |
 * | 200 + 울타리·사고 블록 | text만 모아 울타리 벗김 → 교정 성공 | 코어 `stripFence`·블록 필터 |
 * | 헤더 | `x-api-key`·`anthropic-version: 2023-06-01`·`content-type` / 키는 **x-api-key에만** | Messages API |
 * | 본문 | temperature 없음 · 사고 기본 끔 · 모델·max_tokens·effort·system·payload | 코어 판정표(L30) |
 * | 401·429·billing_error·529·400·JSON 아닌 500 | auth·quota·quota·error·error·error, 호출 1회 | `classifyHttpFailure` |
 * | 연결 실패·타임아웃 | error | status 없음 |
 * | refusal·max_tokens | invalid | 코어 |
 * | usage | 숫자만 누계 | L30 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { refine, MemoryCacheStore, FALLBACK_REASONS } from '../../../src/core/refine/index.js';
import { anthropicUsage } from '../../../src/core/refine/providers/anthropic.js';
import AnthropicFetchClient, { ANTHROPIC_MESSAGES_URL } from '../src/anthropicFetch.js';
import { BASE_BODY, goodRaw } from './helpers.js';

const API_KEY = 'test-key-not-real-0123456789';

const savedThinking = process.env.SAI_ANTHROPIC_THINKING;
test.after(() => {
  if (savedThinking === undefined) delete process.env.SAI_ANTHROPIC_THINKING;
  else process.env.SAI_ANTHROPIC_THINKING = savedThinking;
});

function message(content, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 7 },
  };
}

/** 정해진 상태·본문으로 답하는 가짜 fetch. `rawBody`가 문자열이면 그대로(JSON 아님 시험). */
function fakeFetch(status, body) {
  const seen = { calls: 0 };
  const impl = async (url, init) => {
    seen.calls += 1;
    seen.url = String(url);
    seen.init = init;
    seen.body = JSON.parse(init.body);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new globalThis.Response(text, { status, headers: { 'content-type': 'application/json' } });
  };
  impl.seen = seen;
  return impl;
}

const okText = (text) => message([{ type: 'text', text }]);
const errorBody = (type) => ({ type: 'error', error: { type, message: 'test' } });

const run = (fetchImpl) =>
  refine({ ...BASE_BODY, bypassCache: true }, { apiKey: API_KEY, provider: 'anthropic', cache: new MemoryCacheStore(), fetchImpl });

test('🔴 alias가 걸렸다 — 코어가 부르는 `@anthropic-ai/sdk`는 Worker 대역이다(진짜 SDK 아님)', async () => {
  const mod = await import('@anthropic-ai/sdk');
  assert.equal(mod.default, AnthropicFetchClient, 'test/sdkAlias.mjs가 안 실렸다 — 진짜 SDK를 시험하고 있다');
  // 코어 경로로도 — 대역은 헤더를 평범한 객체로 넘긴다(진짜 SDK는 x-stainless-* 헤더를 붙인다).
  const fetchImpl = fakeFetch(200, okText(JSON.stringify(goodRaw())));
  await run(fetchImpl);
  assert.equal(fetchImpl.seen.calls, 1);
  assert.equal(Object.keys(fetchImpl.seen.init.headers).some((h) => h.startsWith('x-stainless')), false);
});

test('200 — 사고 블록은 건너뛰고 text만, ```json 울타리는 벗긴다', async () => {
  const fetchImpl = fakeFetch(200, message([
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'text', text: '```json\n' + JSON.stringify(goodRaw()) + '\n```' },
  ]));
  const result = await run(fetchImpl);
  assert.equal(fetchImpl.seen.calls, 1, '가짜 fetch를 거치지 않았다');
  assert.equal(result.fallback, false, result.fallbackDetail);
  assert.equal(result.refined, 'Could you review this by tomorrow morning?');
});

test('🔴 헤더 — x-api-key·anthropic-version·content-type, 키는 x-api-key에만 실린다', async () => {
  const fetchImpl = fakeFetch(200, okText(JSON.stringify(goodRaw())));
  await run(fetchImpl);
  const { url, init } = fetchImpl.seen;
  assert.equal(url, ANTHROPIC_MESSAGES_URL);
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.method, 'POST');
  const headers = init.headers;
  assert.equal(headers['x-api-key'], API_KEY);
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(headers['content-type'], 'application/json');
  const keyHolders = Object.entries(headers).filter(([, v]) => String(v).includes(API_KEY)).map(([k]) => k);
  assert.deepEqual(keyHolders, ['x-api-key'], '키가 다른 헤더에도 실렸다');
  assert.equal(Object.keys(headers).some((h) => h.toLowerCase() === 'authorization'), false);
  assert.equal(url.includes(API_KEY), false, '키가 URL에 실렸다');
  assert.equal(init.body.includes(API_KEY), false, '키가 본문에 실렸다');
});

test('🔴 본문 — temperature 없음 · 사고 기본 끔 · 모델·max_tokens·effort·system·payload(코어가 만든 그대로)', async () => {
  delete process.env.SAI_ANTHROPIC_THINKING;
  const fetchImpl = fakeFetch(200, okText(JSON.stringify(goodRaw())));
  await run(fetchImpl);
  const body = fetchImpl.seen.body;
  assert.equal('temperature' in body, false, 'temperature가 실렸다 — 2026-10-21부터 400');
  assert.equal('top_p' in body || 'top_k' in body, false);
  assert.deepEqual(body.thinking, { type: 'disabled' }, '사고가 기본으로 꺼지지 않았다');
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.max_tokens, 8000);
  assert.deepEqual(body.output_config, { effort: 'low' });
  assert.equal(typeof body.system, 'string');
  assert.match(body.system, /^Respond with exactly one JSON object/);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  const payload = JSON.parse(body.messages[0].content);
  assert.equal(payload.text, BASE_BODY.text, 'payload가 user content(JSON)로 가지 않았다');
  assert.equal('stream' in body, false);
});

test('사고 스위치 — `adaptive`일 때만 thinking을 생략한다(코어 판정표 그대로)', async () => {
  process.env.SAI_ANTHROPIC_THINKING = 'adaptive';
  try {
    const fetchImpl = fakeFetch(200, okText(JSON.stringify(goodRaw())));
    await run(fetchImpl);
    assert.equal('thinking' in fetchImpl.seen.body, false);
  } finally {
    delete process.env.SAI_ANTHROPIC_THINKING;
  }
});

test('🔴 오류 분류 — status + error.type → classifyHttpFailure, 재시도 없음(호출 1회)', async () => {
  const rows = [
    [401, errorBody('authentication_error'), FALLBACK_REASONS.AUTH],
    [403, errorBody('permission_error'), FALLBACK_REASONS.AUTH],
    [429, errorBody('rate_limit_error'), FALLBACK_REASONS.QUOTA],
    [400, errorBody('billing_error'), FALLBACK_REASONS.QUOTA], // status만 보면 error — type을 읽어야 quota
    [400, errorBody('invalid_request_error'), FALLBACK_REASONS.ERROR],
    [529, errorBody('overloaded_error'), FALLBACK_REASONS.ERROR],
    [500, '<html>upstream error</html>', FALLBACK_REASONS.ERROR], // JSON 아닌 오류 본문
  ];
  for (const [status, body, expected] of rows) {
    const fetchImpl = fakeFetch(status, body);
    const result = await run(fetchImpl);
    const label = `${status} ${typeof body === 'string' ? '(non-json)' : body.error.type}`;
    assert.equal(result.fallback, true, label);
    assert.equal(result.fallbackReason, expected, label);
    assert.equal(fetchImpl.seen.calls, 1, `${label} — 재시도했다`);
    assert.equal(String(result.fallbackDetail).includes(API_KEY), false, `${label} — 진단 문구에 키`);
    assert.equal(String(result.fallbackDetail).includes('test'), false, `${label} — 응답 error.message를 옮겼다`);
  }
});

test('연결 실패 — error (원래 오류 메시지는 옮기지 않는다)', async () => {
  const fetchImpl = async () => {
    throw new TypeError(`fetch failed ${API_KEY}`);
  };
  const result = await run(fetchImpl);
  assert.equal(result.fallbackReason, FALLBACK_REASONS.ERROR);
  assert.equal(String(result.fallbackDetail).includes(API_KEY), false);
});

test('타임아웃 — 시간 안에 답이 없으면 끊고 status 없는 오류(→ 코어 error)', async () => {
  const hang = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const client = new AnthropicFetchClient({ apiKey: API_KEY, timeout: 20, fetch: hang });
  await assert.rejects(client.messages.create({}), (error) => {
    assert.equal(error.name, 'APIConnectionTimeoutError');
    assert.equal(error.status, undefined);
    return true;
  });
  // 코어 경로 — timeoutMs가 대역의 timeout으로 넘어간다.
  const result = await refine({ ...BASE_BODY, bypassCache: true }, {
    apiKey: API_KEY, provider: 'anthropic', cache: new MemoryCacheStore(), fetchImpl: hang, timeoutMs: 20,
  });
  assert.equal(result.fallbackReason, FALLBACK_REASONS.ERROR);
});

test('200인데 JSON이 아니다 — error', async () => {
  const result = await run(fakeFetch(200, 'not json'));
  assert.equal(result.fallbackReason, FALLBACK_REASONS.ERROR);
});

test('거절·잘림은 invalid', async () => {
  for (const stop of ['refusal', 'max_tokens']) {
    const result = await run(fakeFetch(200, message([], stop)));
    assert.equal(result.fallbackReason, FALLBACK_REASONS.INVALID, stop);
  }
});

test('usage — 숫자만 누계(코어 anthropicUsage)', async () => {
  const before = { ...anthropicUsage };
  await run(fakeFetch(200, okText(JSON.stringify(goodRaw()))));
  assert.equal(anthropicUsage.calls, before.calls + 1);
  assert.equal(anthropicUsage.input, before.input + 10);
  assert.equal(anthropicUsage.output, before.output + 7);
});

test('🔴 fetch를 안 넘기면 **호출 시점의** 전역 fetch를 쓴다(Worker 운영 기본)', async () => {
  const original = globalThis.fetch;
  const fetchImpl = fakeFetch(200, okText(JSON.stringify(goodRaw())));
  const client = new AnthropicFetchClient({ apiKey: API_KEY, timeout: 1000 });
  globalThis.fetch = fetchImpl;
  try {
    const res = await client.messages.create({ model: 'm' });
    assert.equal(res.type, 'message');
    assert.equal(fetchImpl.seen.calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
