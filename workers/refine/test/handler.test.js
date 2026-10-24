/**
 * Worker 핸들러 — CORS·401 모양·성공 교정(가짜 Claude)·로그에 본문 없음. 나머지 mode는 `modes.test.js`.
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

test('decode·decisions·reply는 더 이상 501이 아니다 (2026-10-24 이식 — 상세는 test/modes.test.js)', async () => {
  for (const mode of ['decode', 'decisions', 'reply']) {
    const { handle } = setup();
    // refine 모양 응답이라 코어가 형식 오류 폴백(200) 또는 요청 거절(400)을 낸다 — 어느 쪽이든 501은 아니다.
    const res = await handle(refineRequest(token, { ...BASE_BODY, mode, intent: 'accept' }), TEST_ENV);
    assert.notEqual(res.status, 501, `mode=${mode}`);
  }
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

test('🔴 사고 스위치 — env SAI_ANTHROPIC_THINKING=adaptive일 때만 켠다(실험용), /health도 같은 값을 보고한다', async () => {
  delete process.env.SAI_ANTHROPIC_THINKING;
  const { handle, fetchImpl } = setup();
  const env = { ...TEST_ENV, SAI_ANTHROPIC_THINKING: 'adaptive' };
  assert.equal((await handle(refineRequest(token, BASE_BODY), env)).status, 200);
  assert.equal('thinking' in fetchImpl.seen.bodies[0], false, 'adaptive면 thinking을 생략(모델 기본)해야 한다');
  const health = await (await handle(refineRequest(null, undefined, { method: 'GET', path: '/health' }), env)).json();
  assert.equal(health.thinking, 'adaptive');
  const off = await (await handle(refineRequest(null, undefined, { method: 'GET', path: '/health' }), TEST_ENV)).json();
  assert.equal(off.thinking, 'disabled');
  // 🔴 이전 방식(process.env로 옮김)과 달리 Worker 요청이 process.env를 남기지 않는다.
  assert.equal(process.env.SAI_ANTHROPIC_THINKING, undefined, 'Worker가 process.env에 값을 써 넣었다');
});

test('🔴 사고 스위치 — Worker는 값을 명시해 넘긴다: process.env에 adaptive가 남아 있어도 env에 없으면 끔 (2026-10-24 L33)', async () => {
  process.env.SAI_ANTHROPIC_THINKING = 'adaptive';
  try {
    for (const [envValue, expected] of [[undefined, { type: 'disabled' }], ['typo', { type: 'disabled' }], ['adaptive', '(생략)']]) {
      const { handle, fetchImpl } = setup();
      const env = envValue === undefined ? TEST_ENV : { ...TEST_ENV, SAI_ANTHROPIC_THINKING: envValue };
      assert.equal((await handle(refineRequest(token, BASE_BODY), env)).status, 200);
      const sent = fetchImpl.seen.bodies[0];
      assert.deepEqual('thinking' in sent ? sent.thinking : '(생략)', expected, `env=${envValue}`);
    }
  } finally {
    delete process.env.SAI_ANTHROPIC_THINKING;
  }
});

test('🔴 요청 경로는 globalThis.process를 읽지 않는다 — 첫 접근이 Node 호환 내부를 늦게 불러 콜드 +3ms (2026-10-24 L33)', async () => {
  const { handle } = setup();
  // 전역 `process`를 세는 getter로 잠시 바꾼다 — 교정 1건(가짜 Claude까지)·/health 동안 몇 번 읽는지 본다.
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
  let healthStatus;
  try {
    status = (await handle(refineRequest(token, { ...BASE_BODY, bypassCache: true }), TEST_ENV)).status;
    healthStatus = (await handle(refineRequest(null, undefined, { method: 'GET', path: '/health' }), TEST_ENV)).status;
  } finally {
    Object.defineProperty(globalThis, 'process', descriptor);
  }
  assert.equal(status, 200);
  assert.equal(healthStatus, 200);
  assert.equal(reads, 0, `요청 처리 중 globalThis.process를 ${reads}번 읽었다`);
});

test('🔴 성공(폴백 아님) 교정은 로그를 쓰지 않는다, 폴백은 쓴다 — CPU 한도(2026-10-24 L33)', async () => {
  const ok = setup();
  assert.equal((await ok.handle(refineRequest(token, BASE_BODY), TEST_ENV)).status, 200);
  assert.equal((await ok.handle(refineRequest(token, BASE_BODY), TEST_ENV)).status, 200); // 캐시 적중도 성공
  assert.deepEqual(ok.logger.lines, [], '성공 교정이 로그를 남겼다');

  const failed = setup({ fetchImpl: fakeAnthropicFetch(undefined, { status: 429 }) });
  assert.equal((await failed.handle(refineRequest(token, BASE_BODY), TEST_ENV)).status, 200);
  assert.equal(failed.logger.lines.length, 1, failed.logger.lines.join(' | '));
  assert.match(failed.logger.lines[0], /^\[refine\] provider=anthropic urgency=\S+ intent=\S+ cache=miss fallback=quota \d+ms$/);
});
