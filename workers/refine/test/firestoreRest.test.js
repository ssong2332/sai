/**
 * Worker Firestore REST 어댑터 + 서비스 계정 토큰 (2026-10-26, L33 2단계 U1). 🔴 네트워크 없음.
 *
 * 이 테스트가 지키는 것:
 *  ① 토큰: RS256 서명·aud/iss/scope · 캐시 재사용 · 동시 요청 1회 교환 · 만료 전 갱신 · 잘못된 키는 원문 없이 거절
 *  ② 값 인코딩: 정수/소수/타임스탬프/중첩/배열 왕복 · 읽은 타임스탬프를 다시 쓰면 타임스탬프
 *  ③ set merge = 잎 경로만 · merge 없음 = 통째로 · increment·serverTimestamp 변환
 *  ④ where(==)·limit · 하위 컬렉션 · getAll 순서 · listDocuments(하위만 있는 문서 포함) · recursiveDelete
 *  ⑤ 트랜잭션: 경합(409) 한 번이면 다시 · 그 밖 실패는 바로 · 콜백 오류면 rollback
 *  ⑥ 🔴 Functions 판정 코드를 **고치지 않고** 돌린다 — refineQuota(상한)·betaMetrics(지표)·대역 FieldValue
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';

import { createTokenSource, parseServiceAccount, ServiceAccountError, TOKEN_SCOPE } from '../src/google/serviceAccount.js';
import { RestFirestore, FieldValue, Timestamp, encodeValue, decodeValue, FirestoreRestError } from '../src/google/firestoreRest.js';
import { FieldValue as ShimFieldValue } from 'firebase-admin/firestore';
import { consumeDailyQuota } from '../../../functions/refineQuota.js';
import { recordRequest, recordDailyUser } from '../../../functions/betaMetrics.js';
import { createFakeFirestore } from './fakeFirestore.js';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';

async function makeAccount() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const credentials = JSON.stringify({
    type: 'service_account',
    project_id: 'sai-global-msg-2026',
    client_email: 'worker@sai-global-msg-2026.iam.gserviceaccount.com',
    private_key: await exportPKCS8(privateKey),
    token_uri: TOKEN_URI,
  });
  return { publicKey, credentials };
}

function fakeTokenEndpoint(publicKey, { expiresIn = 3600, status = 200 } = {}) {
  const seen = [];
  const fn = async (url, init) => {
    assert.equal(url, TOKEN_URI);
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload, protectedHeader } = await jwtVerify(form.get('assertion'), publicKey, { audience: TOKEN_URI });
    seen.push({ payload, protectedHeader });
    if (status !== 200) return new globalThis.Response('{}', { status });
    return new globalThis.Response(JSON.stringify({ access_token: `tok-${seen.length}`, expires_in: expiresIn }), { status: 200 });
  };
  return { fn, seen };
}

const db = (fake) => new RestFirestore({ projectId: 'sai-global-msg-2026', token: async () => 'test-token', fetchImpl: fake.fetch });

/* ── ① 토큰 ── */

test('토큰 — RS256 서명, iss·sub = 서비스 계정, scope = cloud-platform, 캐시 재사용', async () => {
  const { publicKey, credentials } = await makeAccount();
  const endpoint = fakeTokenEndpoint(publicKey);
  const source = createTokenSource({ credentials, fetchImpl: endpoint.fn });
  assert.equal(await source.token(), 'tok-1');
  assert.equal(await source.token(), 'tok-1', '만료 전에는 다시 교환하지 않는다');
  assert.equal(source.stats.exchanges, 1);
  const { payload, protectedHeader } = endpoint.seen[0];
  assert.equal(protectedHeader.alg, 'RS256');
  assert.equal(payload.iss, 'worker@sai-global-msg-2026.iam.gserviceaccount.com');
  assert.equal(payload.sub, payload.iss);
  assert.equal(payload.scope, TOKEN_SCOPE);
  assert.equal(payload.exp - payload.iat, 3600);
});

test('토큰 — 동시에 부르면 교환은 한 번 · 만료 1분 전이면 새로 받는다', async () => {
  const { publicKey, credentials } = await makeAccount();
  const endpoint = fakeTokenEndpoint(publicKey, { expiresIn: 120 });
  let t = Date.now();
  const source = createTokenSource({ credentials, fetchImpl: endpoint.fn, now: () => t });
  const [a, b, c] = await Promise.all([source.token(), source.token(), source.token()]);
  assert.deepEqual([a, b, c], ['tok-1', 'tok-1', 'tok-1']);
  assert.equal(source.stats.exchanges, 1);
  t += 59_000;
  assert.equal(await source.token(), 'tok-1', '만료 61초 전 — 그대로');
  t += 2_000;
  assert.equal(await source.token(), 'tok-2', '만료 59초 전 — 갱신');
});

test('🔴 잘못된 키 — 원문을 메시지에 싣지 않고 사유 코드로 거절', async () => {
  assert.throws(() => parseServiceAccount('not-json-SECRET'), (e) => e instanceof ServiceAccountError && e.code === 'bad-credentials' && !e.message.includes('SECRET'));
  assert.throws(() => parseServiceAccount({ client_email: 'x' }), (e) => e.code === 'bad-credentials');
  const bad = createTokenSource({ credentials: { client_email: 'x@y', private_key: '-----BEGIN PRIVATE KEY-----\nSECRETPART\n-----END PRIVATE KEY-----' }, fetchImpl: async () => assert.fail('교환까지 가면 안 된다') });
  await assert.rejects(bad.token(), (e) => e instanceof ServiceAccountError && e.code === 'bad-credentials' && !e.message.includes('SECRETPART'));
});

test('토큰 교환 실패 — 상태 코드만 싣는다', async () => {
  const { publicKey, credentials } = await makeAccount();
  const source = createTokenSource({ credentials, fetchImpl: fakeTokenEndpoint(publicKey, { status: 403 }).fn });
  await assert.rejects(source.token(), (e) => e.code === 'token-exchange' && /403/.test(e.message));
});

/* ── ② 값 ── */

test('값 인코딩 — 정수·소수·불·null·문자·타임스탬프·배열·중첩 왕복', () => {
  assert.deepEqual(encodeValue(3), { integerValue: '3' });
  assert.deepEqual(encodeValue(0.5), { doubleValue: 0.5 });
  assert.deepEqual(encodeValue(new Date('2026-10-26T00:00:00Z')), { timestampValue: '2026-10-26T00:00:00.000Z' });
  const sample = { a: 1, b: 2.5, c: true, d: null, e: 'x', f: [1, 'y'], g: { h: { i: 7 } } };
  assert.deepEqual(decodeValue(encodeValue(sample)), sample);
  const ts = decodeValue({ timestampValue: '2026-10-26T01:02:03Z' });
  assert.ok(ts instanceof Timestamp);
  assert.deepEqual(encodeValue(ts), { timestampValue: '2026-10-26T01:02:03Z' }, '읽은 타임스탬프를 다시 쓰면 타임스탬프');
});

/* ── ③ 쓰기 ── */

test('set merge — 잎 경로만 고치고 나머지 필드는 남긴다 · increment·serverTimestamp', async () => {
  const fake = createFakeFirestore();
  fake.seed('betaMetrics/2026-10-26', { keep: { stringValue: 'yes' }, requests: { mapValue: { fields: { refine: { integerValue: '2' }, decode: { integerValue: '5' } } } } });
  await db(fake).collection('betaMetrics').doc('2026-10-26').set(
    { dateKey: '2026-10-26', requests: { refine: FieldValue.increment(1) }, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  const raw = fake.raw('betaMetrics/2026-10-26');
  assert.equal(raw.keep.stringValue, 'yes', '마스크 밖 필드 유지');
  assert.equal(raw.requests.mapValue.fields.refine.integerValue, '3');
  assert.equal(raw.requests.mapValue.fields.decode.integerValue, '5', '같은 맵의 다른 잎 유지');
  assert.ok(raw.updatedAt.timestampValue);
  assert.equal(raw.dateKey.stringValue, '2026-10-26');
});

test('set (merge 없음) — 문서를 통째로 바꾼다 · delete', async () => {
  const fake = createFakeFirestore();
  fake.seed('teams/t1', { old: { stringValue: 'gone' } });
  const ref = db(fake).collection('teams').doc('t1');
  await ref.set({ name: '팀', count: 2 });
  assert.deepEqual(Object.keys(fake.raw('teams/t1')).sort(), ['count', 'name']);
  const snap = await ref.get();
  assert.equal(snap.exists, true);
  assert.equal(snap.get('name'), '팀');
  assert.deepEqual(snap.data(), { name: '팀', count: 2 });
  await ref.delete();
  assert.equal((await ref.get()).exists, false, '404 → 없음');
});

/* ── ④ 읽기 ── */

test('where(==)·limit · 하위 컬렉션 · getAll은 요청 순서대로', async () => {
  const fake = createFakeFirestore();
  fake.seed('teams/a', { inviteCode: { stringValue: 'AAA' } });
  fake.seed('teams/b', { inviteCode: { stringValue: 'BBB' } });
  fake.seed('teams/b/members/u1', { role: { stringValue: 'owner' } });
  const d = db(fake);
  const found = await d.collection('teams').where('inviteCode', '==', 'BBB').limit(1).get();
  assert.equal(found.size, 1);
  assert.equal(found.docs[0].id, 'b');
  assert.equal((await d.collection('teams').where('inviteCode', '==', 'ZZZ').get()).empty, true);
  const member = await d.collection('teams').doc('b').collection('members').where('role', '==', 'owner').get();
  assert.equal(member.docs[0].ref.path, 'teams/b/members/u1');
  const snaps = await d.getAll(d.doc('teams/b/members/u1'), d.doc('teams/a/members/u1'));
  assert.deepEqual(snaps.map((s) => s.exists), [true, false]);
});

test('listDocuments — 필드 없이 하위만 있는 문서도 · recursiveDelete는 하위까지', async () => {
  const fake = createFakeFirestore();
  fake.seed('teams/a', { name: { stringValue: 'A' } });
  fake.seed('teams/ghost/members/u1', { role: { stringValue: 'member' } });
  fake.seed('teams/a/members/u1', { role: { stringValue: 'owner' } });
  fake.seed('teams/a/glossary/g1', { term: { stringValue: 'x' } });
  fake.seed('teams/keep', { name: { stringValue: 'K' } });
  const d = db(fake);
  assert.deepEqual((await d.collection('teams').listDocuments()).map((r) => r.id), ['a', 'ghost', 'keep']);
  await d.recursiveDelete(d.doc('teams/a'));
  assert.deepEqual(fake.names(), ['teams/ghost/members/u1', 'teams/keep']);
});

/* ── ⑤ 트랜잭션 ── */

test('트랜잭션 — 경합(409)이면 다시 · 그 밖 실패는 바로 · 콜백 오류면 rollback', async () => {
  const fake = createFakeFirestore();
  const d = db(fake);
  fake.failCommitOnce(409);
  let runs = 0;
  const out = await d.runTransaction(async (tx) => {
    runs += 1;
    const snap = await tx.get(d.doc('c/x'));
    tx.set(d.doc('c/x'), { n: (snap.get('n') ?? 0) + 1 });
    return 'done';
  });
  assert.equal(out, 'done');
  assert.equal(runs, 2, '경합 한 번 → 다시 실행');
  assert.equal(fake.raw('c/x').n.integerValue, '1');

  fake.failCommitOnce(500);
  await assert.rejects(d.runTransaction(async (tx) => { tx.set(d.doc('c/y'), { n: 1 }); }), (e) => e instanceof FirestoreRestError && e.status === 500);

  await assert.rejects(d.runTransaction(async () => { throw new Error('boom'); }), /boom/);
  assert.ok(fake.calls.some((c) => c.path === ':rollback'), '콜백이 던지면 rollback');
});

/* ── ⑥ Functions 판정 코드 그대로 ── */

test('🔴 대역 — firebase-admin/firestore의 FieldValue가 REST 어댑터 것이다', () => {
  assert.equal(ShimFieldValue, FieldValue);
});

test('🔴 functions/refineQuota.js 그대로 — 상한 2면 세 번째는 거절, 문서 모양은 Functions와 같다', async () => {
  const fake = createFakeFirestore();
  const d = db(fake);
  const now = new Date('2026-10-26T03:00:00Z'); // 서울 12:00
  const r1 = await consumeDailyQuota(d, { uid: 'u1', limit: 2, now });
  const r2 = await consumeDailyQuota(d, { uid: 'u1', limit: 2, now });
  const r3 = await consumeDailyQuota(d, { uid: 'u1', limit: 2, now });
  assert.deepEqual([r1, r2, r3].map((r) => [r.ok, r.used]), [[true, 1], [true, 2], [false, 2]]);
  const raw = fake.raw('refineQuota/u1_2026-10-26');
  assert.equal(raw.count.integerValue, '2');
  assert.equal(raw.uid.stringValue, 'u1');
  assert.equal(raw.expireAt.timestampValue, '2026-11-02T15:00:00.000Z', '서울 자정 + 8일(TTL 필드)');
});

test('🔴 functions/betaMetrics.js 그대로 — 요청 지표 증가 · 재방문은 직전 7일 상한 문서로 판정', async () => {
  const fake = createFakeFirestore();
  const d = db(fake);
  const now = new Date('2026-10-26T03:00:00Z');
  await recordRequest(d, { mode: 'refine', latencyMs: 1500 }, now);
  await recordRequest(d, { mode: 'refine', fallback: true, fallbackReason: 'quota', latencyMs: 4000 }, now);
  const m = fake.raw('betaMetrics/2026-10-26');
  assert.equal(m.requests.mapValue.fields.refine.integerValue, '2');
  assert.equal(m.outcome.mapValue.fields.ok.integerValue, '1');
  assert.equal(m.outcome.mapValue.fields.quota.integerValue, '1');
  assert.equal(m.latency.mapValue.fields.le2000.integerValue, '1');
  assert.deepEqual(await recordDailyUser(d, 'u1', now), { returning: false });
  fake.seed('refineQuota/u2_2026-10-24', { count: { integerValue: '1' } });
  assert.deepEqual(await recordDailyUser(d, 'u2', now), { returning: true });
  const users = fake.raw('betaMetrics/2026-10-26').users.mapValue.fields;
  assert.equal(users.active.integerValue, '2');
  assert.equal(users.returning.integerValue, '1');
});
