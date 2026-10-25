/**
 * Worker 일일 상한·베타 지표 = Firestore (2026-10-26, L33 2단계 U2). 🔴 네트워크 없음 — 토큰 교환·Firestore·Claude 모두 가짜.
 *
 * 이 테스트가 지키는 것:
 *  ① 상한에 닿으면 429 `{error:'daily-limit', limit}` — Claude를 부르지 않는다
 *  ② 성공 교정은 `refineQuota`·`betaMetrics` 문서를 Functions와 같은 모양으로 남긴다
 *  ③ `/health` `usageStore` — 시크릿 없음 `noop` · 있음 `firestore` · 프로젝트가 다른 키면 `noop`(쓰지 않음) + 사유 코드만 로그
 *  ④ 저장소 장애(Firestore 500)여도 교정은 멈추지 않는다(Functions와 같은 규칙)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8 } from 'jose';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { createHandler } from '../src/handler.js';
import { createFirestoreUsageStore, usageStoreFromEnv } from '../src/usageStore.js';
import { RestFirestore } from '../src/google/firestoreRest.js';
import { resetGoogleClients } from '../src/google/clients.js';
import { createFakeFirestore } from './fakeFirestore.js';
import { BASE_BODY, TEST_ENV, captureLogger, fakeAnthropicFetch, makeKeys, refineRequest, signIdToken } from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);
const health = (handle, env) => handle(refineRequest(null, undefined, { method: 'GET', path: '/health' }), env).then((r) => r.json());

async function serviceAccount(projectId = 'sai-global-msg-2026') {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  return JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    client_email: `worker@${projectId}.iam.gserviceaccount.com`,
    private_key: await exportPKCS8(privateKey),
  });
}

/** 토큰 교환·Firestore·Claude를 URL로 가르는 가짜 fetch. */
function routedFetch(fake, claude = fakeAnthropicFetch()) {
  const seen = { tokenExchanges: 0 };
  const impl = async (url, init) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      seen.tokenExchanges += 1;
      return new globalThis.Response(JSON.stringify({ access_token: 'tok-test', expires_in: 3600 }), { status: 200 });
    }
    if (u.startsWith('https://firestore.googleapis.com/')) return fake.fetch(url, init);
    return claude(url, init);
  };
  impl.seen = seen;
  impl.claude = claude;
  return impl;
}

test('① 상한에 닿으면 429 daily-limit, Claude는 부르지 않는다 · ② 문서 모양은 Functions와 같다', async () => {
  const fake = createFakeFirestore();
  const db = new RestFirestore({ projectId: 'sai-global-msg-2026', token: async () => 't', fetchImpl: fake.fetch });
  const claude = fakeAnthropicFetch();
  const handle = createHandler({
    jwks: keys.jwks,
    fetchImpl: claude,
    usageStore: createFirestoreUsageStore({ db, limit: 2 }),
    cache: new MemoryCacheStore(),
    logger: captureLogger(),
  });
  const r1 = await handle(refineRequest(token, { ...BASE_BODY, text: '첫 번째 요청입니다' }), TEST_ENV);
  const r2 = await handle(refineRequest(token, { ...BASE_BODY, text: '두 번째 요청입니다' }), TEST_ENV);
  const r3 = await handle(refineRequest(token, { ...BASE_BODY, text: '세 번째 요청입니다' }), TEST_ENV);
  assert.deepEqual([r1.status, r2.status, r3.status], [200, 200, 429]);
  assert.deepEqual(await r3.json(), { error: 'daily-limit', limit: 2 });
  assert.equal(claude.seen.calls, 2, '막힌 요청은 Claude까지 가지 않는다');
  const quotaDoc = fake.names().find((n) => n.startsWith('refineQuota/uid-test-123_'));
  assert.ok(quotaDoc, 'refineQuota/{uid}_{서울날짜}');
  assert.equal(fake.raw(quotaDoc).count.integerValue, '2');
  const metricsDoc = fake.names().find((n) => n.startsWith('betaMetrics/'));
  const m = fake.raw(metricsDoc);
  assert.equal(m.requests.mapValue.fields.refine.integerValue, '2');
  assert.equal(m.users.mapValue.fields.active.integerValue, '1', '그날 첫 요청에서 한 번만');
});

test('③ /health usageStore — 시크릿 없음 noop · 있음 firestore · 다른 프로젝트 키는 noop(쓰지 않음)', async () => {
  resetGoogleClients();
  const fake = createFakeFirestore();
  const fetchImpl = routedFetch(fake);
  const logger = captureLogger();
  const handle = createHandler({ jwks: keys.jwks, fetchImpl, usageStore: (env) => usageStoreFromEnv(env, { fetchImpl }), logger });
  assert.equal((await health(handle, TEST_ENV)).usageStore, 'noop');
  const good = await serviceAccount();
  assert.equal((await health(handle, { ...TEST_ENV, GOOGLE_SERVICE_ACCOUNT: good })).usageStore, 'firestore');
  resetGoogleClients();
  const other = await serviceAccount('someone-else-project');
  assert.equal((await health(handle, { ...TEST_ENV, GOOGLE_SERVICE_ACCOUNT: other })).usageStore, 'noop');
  assert.ok(logger.lines.some((l) => l.includes('project-mismatch')), '사유 코드');
  assert.ok(logger.lines.every((l) => !l.includes('PRIVATE KEY')), '🔴 키 원문은 로그에 없다');
});

test('③ 시크릿 경로 끝까지 — 토큰을 한 번 받아 Bearer로 Firestore에 쓴다', async () => {
  resetGoogleClients();
  const fake = createFakeFirestore();
  const fetchImpl = routedFetch(fake);
  const handle = createHandler({ jwks: keys.jwks, fetchImpl, usageStore: (env) => usageStoreFromEnv(env, { fetchImpl }), cache: new MemoryCacheStore(), logger: captureLogger() });
  const env = { ...TEST_ENV, GOOGLE_SERVICE_ACCOUNT: await serviceAccount() };
  assert.equal((await handle(refineRequest(token, { ...BASE_BODY, text: '하나' }), env)).status, 200);
  assert.equal((await handle(refineRequest(token, { ...BASE_BODY, text: '둘' }), env)).status, 200);
  assert.equal(fetchImpl.seen.tokenExchanges, 1, '토큰은 isolate 안에서 재사용');
  const quotaDoc = fake.names().find((n) => n.startsWith('refineQuota/'));
  assert.equal(fake.raw(quotaDoc).count.integerValue, '2');
});

test('④ Firestore 장애여도 교정은 멈추지 않는다 — 로그는 사유 코드만', async () => {
  const failing = async () => new globalThis.Response(JSON.stringify({ error: { status: 'INTERNAL' } }), { status: 500 });
  const db = new RestFirestore({ projectId: 'sai-global-msg-2026', token: async () => 't', fetchImpl: failing });
  const logger = captureLogger();
  const handle = createHandler({ jwks: keys.jwks, fetchImpl: fakeAnthropicFetch(), usageStore: createFirestoreUsageStore({ db }), cache: new MemoryCacheStore(), logger });
  const res = await handle(refineRequest(token, BASE_BODY), TEST_ENV);
  assert.equal(res.status, 200);
  assert.ok(logger.lines.some((l) => l.includes('상한 확인 실패')));
  assert.ok(logger.lines.every((l) => !l.includes(BASE_BODY.text)), '🔴 본문은 로그에 없다');
});
