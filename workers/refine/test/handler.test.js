/**
 * Worker 핸들러 — CORS·401 모양·성공 교정(가짜 Claude)·501·로그에 본문 없음.
 * 🔴 네트워크 없음: 토큰은 로컬 키, Claude는 `fakeAnthropicFetch`. 모든 refine 요청이 가짜 fetch를 거치는지
 *    `seen.calls`로 확인한다(안 거치면 SDK가 실제 API를 부른다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import {
  BASE_BODY,
  EXT_ORIGIN,
  TEST_ENV,
  captureLogger,
  fakeAnthropicFetch,
  makeKeys,
  refineRequest,
  signIdToken,
} from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);

/** 🔴 process.env를 건드리는 테스트가 있다 — 끝나면 되돌린다. */
const savedThinking = process.env.SAI_ANTHROPIC_THINKING;
test.after(() => {
  if (savedThinking === undefined) delete process.env.SAI_ANTHROPIC_THINKING;
  else process.env.SAI_ANTHROPIC_THINKING = savedThinking;
});

function setup({ fetchImpl = fakeAnthropicFetch(), usageStore = createMemoryUsageStore() } = {}) {
  const logger = captureLogger();
  const handle = createHandler({ jwks: keys.jwks, fetchImpl, usageStore, cache: new MemoryCacheStore(), logger });
  return { handle, logger, fetchImpl, usageStore };
}

test('성공 교정 — 기존 refineV1과 같은 응답 계약, Claude는 가짜 fetch로만', async () => {
  const { handle, fetchImpl, usageStore } = setup();
  const res = await handle(refineRequest(token, BASE_BODY), TEST_ENV);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), EXT_ORIGIN);
  const body = await res.json();
  assert.equal(body.refined, 'Could you review this by tomorrow morning?');
  assert.equal(body.urgency, 'NORMAL');
  assert.equal(body.cached, false);
  assert.equal(body.fallback, false);
  assert.equal(typeof body.threadContextCount, 'number');

  assert.equal(fetchImpl.seen.calls, 1);
  assert.match(fetchImpl.seen.urls[0], /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  const sent = fetchImpl.seen.bodies[0];
  assert.equal(sent.model, 'claude-haiku-5-5');
  assert.equal('temperature' in sent, false, '🔴 temperature는 보내면 400');
  assert.deepEqual(sent.thinking, { type: 'disabled' }, '🔴 설정 없이도 사고가 꺼져야 한다(2026-10-23 기본)');

  assert.equal(usageStore.requests.length, 1);
  assert.deepEqual(Object.keys(usageStore.requests[0]).sort(), ['fallback', 'fallbackReason', 'latencyMs', 'mode']);
});

test('같은 문장 두 번 → 두 번째는 캐시(Claude 1회)', async () => {
  const { handle, fetchImpl } = setup();
  await handle(refineRequest(token, BASE_BODY), TEST_ENV);
  const res = await handle(refineRequest(token, BASE_BODY), TEST_ENV);
  assert.equal((await res.json()).cached, true);
  assert.equal(fetchImpl.seen.calls, 1);
});

test('Claude 429 + GROQ 키 없음 → 200 폴백(quota) — 키 없는 단계는 건너뛰고 대체 호출 없음', async () => {
  const { handle, fetchImpl } = setup({ fetchImpl: fakeAnthropicFetch(undefined, { status: 429 }) });
  const res = await handle(refineRequest(token, BASE_BODY), TEST_ENV);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fallback, true);
  assert.equal(body.fallbackReason, 'quota');
  assert.equal(fetchImpl.seen.calls, 1, '재시도·대체 호출 없음');
});

test('401 모양 — 토큰 없음 {error:"unauthorized", reason:"no-token"}, LLM 안 부름', async () => {
  const { handle, fetchImpl } = setup();
  const res = await handle(refineRequest(null, BASE_BODY), TEST_ENV);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'unauthorized', reason: 'no-token' });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), EXT_ORIGIN, '확장이 401 본문을 읽을 수 있어야 한다');
  assert.equal(fetchImpl.seen.calls, 0);
});

test('401 모양 — 위조·다른 프로젝트 토큰 {reason:"bad-token"}', async () => {
  const { handle, fetchImpl } = setup();
  const forged = await signIdToken(await makeKeys(keys.kid));
  const otherAud = await signIdToken(keys, { aud: 'other-project' });
  for (const bad of [forged, otherAud, 'garbage']) {
    const res = await handle(refineRequest(bad, BASE_BODY), TEST_ENV);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized', reason: 'bad-token' });
  }
  assert.equal(fetchImpl.seen.calls, 0);
});

test('🔴 CORS — 다른 오리진은 403, CORS 헤더 없음, 토큰이 맞아도 LLM 안 부름', async () => {
  const { handle, fetchImpl } = setup();
  for (const origin of ['https://evil.example', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) {
    const res = await handle(refineRequest(token, BASE_BODY, { origin }), TEST_ENV);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  }
  const preflight = await handle(refineRequest(null, undefined, { origin: 'https://evil.example', method: 'OPTIONS' }), TEST_ENV);
  assert.equal(preflight.status, 403);
  assert.equal(fetchImpl.seen.calls, 0);
});

test('CORS — 확장 오리진 사전 요청 204 + 허용 헤더', async () => {
  const { handle } = setup();
  const res = await handle(refineRequest(null, undefined, { method: 'OPTIONS' }), TEST_ENV);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), EXT_ORIGIN);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('Origin 없음(curl) → CORS 헤더 없이 처리 — 무인증이면 401(CLAUDE.md 확인 절차와 같다)', async () => {
  const { handle } = setup();
  const res = await handle(refineRequest(null, {}, { origin: null }), TEST_ENV);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('1단계 미지원 mode(decode·decisions·reply) → 501, 상한·LLM 안 씀', async () => {
  const { handle, fetchImpl, usageStore } = setup();
  for (const mode of ['decode', 'decisions', 'reply']) {
    const res = await handle(refineRequest(token, { ...BASE_BODY, mode }), TEST_ENV);
    assert.equal(res.status, 501);
    assert.deepEqual(await res.json(), { error: 'not implemented', mode });
  }
  assert.equal(fetchImpl.seen.calls, 0);
  assert.equal(usageStore.requests.length, 0);
  assert.equal(usageStore.dailyUsers.size, 0);
});

test('명시 provider(gemini)의 키가 없으면 대체하지 않고 500', async () => {
  const { handle, fetchImpl } = setup();
  const res = await handle(refineRequest(token, { ...BASE_BODY, provider: 'gemini' }), TEST_ENV);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'no provider configured' });
  assert.equal(fetchImpl.seen.calls, 0);
});

test('키 시크릿 없음 → 500, 설정 누락 → 500', async () => {
  const { handle } = setup();
  const noKey = await handle(refineRequest(token, BASE_BODY), { ...TEST_ENV, ANTHROPIC_API_KEY: '' });
  assert.equal(noKey.status, 500);
  const noProject = await handle(refineRequest(token, BASE_BODY), { ...TEST_ENV, FIREBASE_PROJECT_ID: '' });
  assert.equal(noProject.status, 500);
});

test('잘못된 요청 — 깨진 JSON 400, 빈 text 400(코어 RefineRequestError)', async () => {
  const { handle, fetchImpl } = setup();
  assert.equal((await handle(refineRequest(token, '{not json'), TEST_ENV)).status, 400);
  assert.equal((await handle(refineRequest(token, { ...BASE_BODY, text: '' }), TEST_ENV)).status, 400);
  assert.equal(fetchImpl.seen.calls, 0);
});

test('일일 상한(메모리 스텁) — 초과면 429 {error:"daily-limit"}, LLM 안 부름', async () => {
  const { handle, fetchImpl } = setup({ usageStore: createMemoryUsageStore({ limit: 1 }) });
  assert.equal((await handle(refineRequest(token, BASE_BODY), TEST_ENV)).status, 200);
  const res = await handle(refineRequest(token, { ...BASE_BODY, text: '다른 문장입니다' }), TEST_ENV);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'daily-limit', limit: 1 });
  assert.equal(fetchImpl.seen.calls, 1);
});

test('라우팅 — GET /v1/refine 405, 모르는 경로 404, /health는 키 값 없이 유무만', async () => {
  const { handle } = setup();
  assert.equal((await handle(refineRequest(token, undefined, { method: 'GET' }), TEST_ENV)).status, 405);
  assert.equal((await handle(refineRequest(token, undefined, { method: 'GET', path: '/x' }), TEST_ENV)).status, 404);
  const res = await handle(refineRequest(null, undefined, { method: 'GET', path: '/health' }), TEST_ENV);
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.equal(raw.includes(TEST_ENV.ANTHROPIC_API_KEY), false, '🔴 키 값이 응답에 나갔다');
  const body = JSON.parse(raw);
  assert.equal(body.configured, true);
  assert.deepEqual(body.availableProviders, ['anthropic']);
});

test('🔴 Zero Retention — 성공·폴백·401·400 어느 경로에서도 로그에 본문·교정문·토큰·키가 없다', async () => {
  const secretText = '고유한본문문자열_ZR_7f3a 내일까지 결제 모듈 배포 부탁드립니다';
  const raw = { ...(await import('./helpers.js')).goodRaw(), refined: 'UNIQUE_REFINED_ZR_9b1c', backTranslation: '고유역번역_ZR' };
  const cases = [
    { fetchImpl: fakeAnthropicFetch(raw), tok: token },
    { fetchImpl: fakeAnthropicFetch(raw, { status: 429 }), tok: token },
    { fetchImpl: fakeAnthropicFetch(raw), tok: 'bad.token.value' },
  ];
  for (const { fetchImpl, tok } of cases) {
    const { handle, logger } = setup({ fetchImpl });
    await handle(refineRequest(tok, { ...BASE_BODY, text: secretText }), TEST_ENV);
    await handle(refineRequest(tok, { ...BASE_BODY, text: secretText, sourceLanguage: 'xx' }), TEST_ENV);
    const all = logger.lines.join('\n');
    assert.ok(logger.lines.length > 0, '로그가 하나도 없으면 검사가 무의미하다');
    for (const needle of ['고유한본문문자열_ZR_7f3a', 'UNIQUE_REFINED_ZR_9b1c', '고유역번역_ZR', token, tok, TEST_ENV.ANTHROPIC_API_KEY]) {
      assert.equal(all.includes(needle), false, `로그에 남았다: ${needle.slice(0, 12)}…`);
    }
  }
});

test('🔴 사고 스위치 — SAI_ANTHROPIC_THINKING=adaptive일 때만 켠다(실험용), /health도 같은 값을 보고한다', async () => {
  const { handle, fetchImpl } = setup();
  const env = { ...TEST_ENV, SAI_ANTHROPIC_THINKING: 'adaptive' };
  assert.equal((await handle(refineRequest(token, BASE_BODY), env)).status, 200);
  assert.equal('thinking' in fetchImpl.seen.bodies[0], false, 'adaptive면 thinking을 생략(모델 기본)해야 한다');
  const health = await (await handle(refineRequest(null, undefined, { method: 'GET', path: '/health' }), env)).json();
  assert.equal(health.thinking, 'adaptive');
  process.env.SAI_ANTHROPIC_THINKING = 'disabled'; // 다른 테스트에 새지 않게
  const off = await (await handle(refineRequest(null, undefined, { method: 'GET', path: '/health' }), TEST_ENV)).json();
  assert.equal(off.thinking, 'disabled');
});
