/**
 * 다듬기 품질 모드 (2026-10-30) — 확장은 이름만 보내고 모델·사고·effort는 서버 표(`quality.js`)가 정한다.
 * 🔴 네트워크 없음: Claude·Groq는 가짜 fetch. 보낸 요청 본문은 모양 검사에만 쓴다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { DEFAULT_QUALITY, QUALITY_MODES } from '../../../src/core/refine/quality.js';
import { createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import {
  BASE_BODY,
  CHAIN_ENV,
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

function setup(fetchImpl) {
  const logger = captureLogger();
  const handle = createHandler({
    jwks: keys.jwks,
    fetchImpl,
    usageStore: createMemoryUsageStore(),
    cache: new MemoryCacheStore(),
    logger,
  });
  return { handle, logger };
}

/** 표 한 줄이 Claude 요청 본문에 그대로 실렸는지. */
function assertSentAs(sent, quality) {
  const row = QUALITY_MODES[quality];
  assert.equal(sent.model, row.model, `${quality} 모델`);
  assert.equal(sent.output_config?.effort, row.effort, `${quality} effort`);
  const expectedThinking =
    row.thinking === 'adaptive' ? '(생략)' : { type: row.thinking === 'between_tools' ? 'between_tools' : 'disabled' };
  assert.deepEqual('thinking' in sent ? sent.thinking : '(생략)', expectedThinking, `${quality} 사고`);
}

for (const quality of Object.keys(QUALITY_MODES)) {
  test(`quality=${quality} → 표의 모델·사고·effort로 부르고, 응답에 모드 이름을 붙인다`, async () => {
    const fetchImpl = fakeAnthropicFetch();
    const { handle } = setup(fetchImpl);
    const res = await handle(refineRequest(token, { ...BASE_BODY, quality }), TEST_ENV);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.quality, quality);
    assert.equal(JSON.stringify(body).includes(QUALITY_MODES[quality].model), false, '🔴 응답에 모델명을 싣지 않는다');
    assertSentAs(fetchImpl.seen.bodies[0], quality);
  });
}

test('🔴 quality 없음·모르는 값·모델명 → 기본 모드(옛 확장·요청 조작)', async () => {
  for (const quality of [undefined, 'turbo', 'claude-opus-5-5', 42, null]) {
    const fetchImpl = fakeAnthropicFetch();
    const { handle } = setup(fetchImpl);
    const res = await handle(refineRequest(token, { ...BASE_BODY, quality }), TEST_ENV);
    assert.equal((await res.json()).quality, DEFAULT_QUALITY, String(quality));
    assertSentAs(fetchImpl.seen.bodies[0], DEFAULT_QUALITY);
  }
});

test('🔴 같은 문장이라도 모드가 다르면 캐시를 나눈다', async () => {
  const fetchImpl = fakeAnthropicFetch();
  const { handle } = setup(fetchImpl);
  const qualities = Object.keys(QUALITY_MODES);
  for (const quality of qualities) await handle(refineRequest(token, { ...BASE_BODY, quality }), TEST_ENV);
  const distinctRows = new Set(qualities.map((q) => JSON.stringify(QUALITY_MODES[q]))).size;
  assert.equal(fetchImpl.seen.calls, distinctRows, '다른 설정이 같은 캐시를 받았다');
});

test('🔴 quality를 실어도 폴오버는 그대로 — 한도면 groq가 답하고, groq에는 Claude 모델을 넘기지 않는다', async () => {
  const inner = fakeMultiFetch({ anthropic: 429 });
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return inner(url, init);
  };
  const { handle } = setup(fetchImpl);
  const res = await handle(refineRequest(token, { ...BASE_BODY, quality: 'deep' }), CHAIN_ENV);
  const body = await res.json();
  assert.equal(body.fallback, false);
  assert.equal(body.providerUsed, 'groq');
  const groq = bodies.find((b) => b.url.startsWith('https://api.groq.com/'));
  assert.ok(groq, 'groq를 부르지 않았다');
  assert.equal(String(groq.body?.model).startsWith('claude-'), false, 'groq에 Claude 모델명을 넘겼다');
});

test('뜻 풀기(decode)에는 품질 모드를 적용하지 않는다 — 응답에 quality 없음', async () => {
  const fetchImpl = fakeAnthropicFetch();
  const { handle } = setup(fetchImpl);
  const res = await handle(refineRequest(token, { ...BASE_BODY, mode: 'decode', quality: 'deep' }), TEST_ENV);
  assert.equal('quality' in (await res.json()), false);
});

test('🔴 로그에는 모드 이름까지만 — 본문 없음은 handler.test.js가 잠근다, 여기서는 모델명도 로그에 안 남는지', async () => {
  const fetchImpl = fakeAnthropicFetch();
  const { handle, logger } = setup(fetchImpl);
  await handle(refineRequest(token, { ...BASE_BODY, quality: 'deep' }), TEST_ENV);
  assert.equal(logger.lines.join('\n').includes(BASE_BODY.text), false);
});
