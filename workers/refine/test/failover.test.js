/**
 * Worker 폴오버 (2026-10-23 — anthropic → groq). 🔴 네트워크 없음: 모든 provider는 `fakeMultiFetch`가 URL로 가려 답한다.
 *
 * 판정표 (`src/core/refine/failover.js` — Worker는 표를 다시 적지 않고 그 함수를 쓴다)
 * | 1차 결과 | 명시 provider | 다음 단계 키 | 기대 |
 * |---|---|---|---|
 * | anthropic quota(429) | 없음 | GROQ 있음 | groq가 답함, `providerUsed:'groq'` |
 * | anthropic auth(401) | 없음 | GROQ 있음 | groq가 답함 |
 * | anthropic error(500) | 없음 | GROQ 있음 | 넘기지 않음 — 폴백(error) |
 * | anthropic quota | `anthropic` | GROQ 있음 | 넘기지 않음 — 폴백(quota) |
 * | anthropic quota | 없음 | GROQ 없음 | 건너뜀 — 폴백(quota), 호출 1회 |
 * | ANTHROPIC 키 없음 | 없음 | GROQ 있음 | groq가 1차(표기 없음) |
 * | groq quota(ANTHROPIC 키 없어 groq가 1차) | 없음 | ANTHROPIC 없음 | 건너뜀 — 폴백(quota) |
 * | anthropic quota → groq quota | 없음 | — | 사슬 끝 — 폴백(quota), gemini를 부르지 않는다(키가 있어도) |
 * | 키 전무(ANTHROPIC·GROQ 없음, GEMINI만) | 없음 | — | 500 — 사슬 밖으로 대체하지 않는다 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import { BASE_BODY, CHAIN_ENV, TEST_ENV, captureLogger, fakeMultiFetch, makeKeys, refineRequest, signIdToken } from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);

const savedThinking = process.env.SAI_ANTHROPIC_THINKING;
test.after(() => {
  if (savedThinking === undefined) delete process.env.SAI_ANTHROPIC_THINKING;
  else process.env.SAI_ANTHROPIC_THINKING = savedThinking;
});

/** 한 번 부르고 (응답 본문, 가짜 fetch 기록, 로그)를 돌려준다. */
async function call({ statuses = {}, env = CHAIN_ENV, body = BASE_BODY } = {}) {
  const fetchImpl = fakeMultiFetch(statuses);
  const logger = captureLogger();
  const handle = createHandler({
    jwks: keys.jwks,
    fetchImpl,
    usageStore: createMemoryUsageStore(),
    cache: new MemoryCacheStore(),
    logger,
  });
  const res = await handle(refineRequest(token, body), env);
  return { status: res.status, body: await res.json(), seen: fetchImpl.seen, logger };
}

test('🔴 anthropic quota(429) → groq가 답한다, providerUsed·modelUsed 표기', async () => {
  const { status, body, seen } = await call({ statuses: { anthropic: 429 } });
  assert.equal(status, 200);
  assert.equal(body.fallback, false);
  assert.equal(body.providerUsed, 'groq');
  assert.equal(body.modelUsed, null, '사슬 단계 모델 null = groq 기본 모델');
  assert.deepEqual(seen.order, ['anthropic', 'groq']);
});

test('🔴 anthropic auth(401, 키 무효) → groq가 답한다(L15 규칙)', async () => {
  const { body, seen } = await call({ statuses: { anthropic: 401 } });
  assert.equal(body.fallback, false);
  assert.equal(body.providerUsed, 'groq');
  assert.deepEqual(seen.order, ['anthropic', 'groq']);
});

test('anthropic 일반 오류(500) → 넘기지 않는다(두 번 불러도 같은 이유로 실패)', async () => {
  const { body, seen } = await call({ statuses: { anthropic: 500 } });
  assert.equal(body.fallback, true);
  assert.equal(body.fallbackReason, 'error');
  assert.equal('providerUsed' in body, false);
  assert.deepEqual(seen.order, ['anthropic']);
});

test('🔴 명시 provider(anthropic) → 한도여도 넘기지 않는다', async () => {
  const { body, seen } = await call({ statuses: { anthropic: 429 }, body: { ...BASE_BODY, provider: 'anthropic' } });
  assert.equal(body.fallback, true);
  assert.equal(body.fallbackReason, 'quota');
  assert.deepEqual(seen.order, ['anthropic']);
});

test('🔴 명시 provider(groq) → groq만 부른다(사슬 무시)', async () => {
  const { body, seen } = await call({ statuses: { groq: 429 }, body: { ...BASE_BODY, provider: 'groq' } });
  assert.equal(body.fallbackReason, 'quota');
  assert.deepEqual(seen.order, ['groq']);
});

test('🔴 GROQ 키 없음 → 그 단계는 건너뛴다(폴백 quota, 호출 1회)', async () => {
  const { body, seen } = await call({ statuses: { anthropic: 429 }, env: TEST_ENV });
  assert.equal(body.fallback, true);
  assert.equal(body.fallbackReason, 'quota');
  assert.deepEqual(seen.order, ['anthropic']);
});

test('🔴 ANTHROPIC 키 없음 → groq가 1차(기본값 판정), 표기 없음', async () => {
  const env = { ...CHAIN_ENV, ANTHROPIC_API_KEY: '' };
  const { body, seen } = await call({ env });
  assert.equal(body.fallback, false);
  assert.equal('providerUsed' in body, false, '1차가 그대로 답하면 표기를 붙이지 않는다(Functions와 같다)');
  assert.deepEqual(seen.order, ['groq']);
});

test('🔴 groq가 1차이고 quota → 남은 anthropic은 키가 없어 건너뛴다', async () => {
  const env = { ...CHAIN_ENV, ANTHROPIC_API_KEY: '' };
  const { body, seen } = await call({ env, statuses: { groq: 429 } });
  assert.equal(body.fallbackReason, 'quota');
  assert.deepEqual(seen.order, ['groq']);
});

test('🔴 사슬 끝(anthropic quota → groq quota) → 폴백, Gemini를 부르지 않는다(키가 있어도)', async () => {
  const env = { ...CHAIN_ENV, GEMINI_API_KEY: 'test-gemini-key-not-real' };
  const { body, seen } = await call({ env, statuses: { anthropic: 429, groq: 429 } });
  assert.equal(body.fallback, true);
  assert.equal(body.fallbackReason, 'quota');
  assert.deepEqual(seen.order, ['anthropic', 'groq']);
  assert.equal(seen.byProvider.gemini, undefined, '🔴 Gemini는 사슬 밖이다(사용자 결정 (b))');
});

test('키가 하나도 없으면 500 no provider configured — 사슬 밖(gemini)으로 대체하지 않는다', async () => {
  const env = { ...TEST_ENV, ANTHROPIC_API_KEY: '', GEMINI_API_KEY: 'test-gemini-key-not-real' };
  const { status, body, seen } = await call({ env });
  assert.equal(status, 500);
  assert.deepEqual(body, { error: 'no provider configured' });
  assert.equal(seen.calls, 0);
});

test('/health — 사슬 순서로 보고하고 키 값은 없다', async () => {
  const handle = createHandler({ jwks: keys.jwks, fetchImpl: fakeMultiFetch(), logger: captureLogger() });
  const res = await handle(refineRequest(null, undefined, { method: 'GET', path: '/health' }), CHAIN_ENV);
  const raw = await res.text();
  assert.equal(raw.includes(CHAIN_ENV.GROQ_API_KEY), false);
  const body = JSON.parse(raw);
  assert.equal(body.provider, 'anthropic');
  assert.deepEqual(body.availableProviders, ['anthropic', 'groq']);
  assert.deepEqual(body.failoverChain, ['anthropic', 'groq']);
});

test('🔴 Zero Retention — 폴오버 로그에도 본문이 없다', async () => {
  const secret = '폴오버고유본문_ZR_51ab 내일까지 확인 부탁드립니다';
  const { logger } = await call({ statuses: { anthropic: 429 }, body: { ...BASE_BODY, text: secret } });
  const all = logger.lines.join('\n');
  assert.match(all, /anthropic quota — groq로 다시 시도합니다/);
  assert.equal(all.includes('폴오버고유본문_ZR_51ab'), false);
  assert.equal(all.includes(CHAIN_ENV.GROQ_API_KEY), false);
});
