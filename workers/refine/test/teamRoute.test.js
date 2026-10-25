/**
 * Worker 팀 API `POST /v1/team` (2026-10-26, L33 2단계 U3). 🔴 네트워크 없음 — Firestore·Identity Toolkit 모두 가짜.
 *
 * 이 테스트가 지키는 것 (판정은 functions/*.js 그대로 — 여기는 그 코드가 Worker 배선 위에서 같은 결과를 내는지):
 *  ① 팀 만들기 → 초대 코드로 참가 → 팀원 목록 · 팀장만 권한 바꾸기 · 팀원은 403
 *  ② 지표 올리기 — L34 맥락 키(decoded 등)도 받는다(운영 Functions가 버리던 것) · 기여자 uid를 남기지 않는다
 *  ③ 혼자인 팀장 나가기 = 팀·명부·지표 전부 삭제 · 계정 삭제 = Auth 삭제 호출(없는 계정이면 성공으로)
 *  ④ 거절 모양: 토큰 없음 401 · 모르는 action 400 · GET 405 · 시크릿 없음 503 · /health team
 *  ⑤ 🔴 로그에 팀 이름·이메일·초대 코드가 없다
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../src/handler.js';
import { RestFirestore } from '../src/google/firestoreRest.js';
import { createNoopUsageStore } from '../src/usageStore.js';
import { randomInt } from '../src/teamRoute.js';
import { createFakeFirestore } from './fakeFirestore.js';
import { TEST_ENV, captureLogger, makeKeys, refineRequest, signIdToken } from './helpers.js';

const keys = await makeKeys();
const ownerToken = await signIdToken(keys, { sub: 'owner-uid', email: 'owner@example.com' });
const memberToken = await signIdToken(keys, { sub: 'member-uid', email: 'member@example.com' });

function setup({ withGoogle = true } = {}) {
  const fake = createFakeFirestore();
  const authCalls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://identitytoolkit.googleapis.com/')) {
      authCalls.push(JSON.parse(init.body).localId);
      // 이미 없는 계정 — admin처럼 USER_NOT_FOUND
      return new globalThis.Response(JSON.stringify({ error: { message: 'USER_NOT_FOUND' } }), { status: 400 });
    }
    return fake.fetch(url, init);
  };
  const db = new RestFirestore({ projectId: TEST_ENV.FIREBASE_PROJECT_ID, token: async () => 'test-token', fetchImpl });
  const google = withGoogle ? { db, tokenSource: { token: async () => 'test-token' }, projectId: TEST_ENV.FIREBASE_PROJECT_ID, fetchImpl } : null;
  const logger = captureLogger();
  const handle = createHandler({ jwks: keys.jwks, usageStore: createNoopUsageStore(), google: () => google, logger });
  const call = async (token, body) => {
    const res = await handle(refineRequest(token, body, { path: '/v1/team' }), TEST_ENV);
    return { status: res.status, body: await res.json() };
  };
  return { fake, call, logger, authCalls, handle };
}

test('① 팀 만들기 → 참가 → 목록 · 권한은 팀장만', async () => {
  const { fake, call } = setup();
  const created = await call(ownerToken, { action: 'create', name: '서울 프론트팀', displayName: '수홍' });
  assert.equal(created.status, 200);
  const { teamId, inviteCode } = created.body;
  assert.match(inviteCode, /^[A-Z0-9]{6}$/);
  assert.equal(created.body.role, 'owner');
  assert.equal(fake.raw(`teams/${teamId}`).ownerUid.stringValue, 'owner-uid');
  assert.equal(fake.raw(`teams/${teamId}/members/owner-uid`).role.stringValue, 'owner');

  const joined = await call(memberToken, { action: 'join', inviteCode: inviteCode.toLowerCase() });
  assert.deepEqual(joined, { status: 200, body: { teamId, name: '서울 프론트팀', role: 'member', canViewDashboard: false } });

  const members = await call(ownerToken, { action: 'members', teamId });
  assert.equal(members.status, 200);
  assert.equal(members.body.members.length, 2);

  assert.equal((await call(memberToken, { action: 'permission', teamId, uid: 'owner-uid', canViewDashboard: false })).status, 403, '팀원은 못 바꾼다');
  assert.equal((await call(ownerToken, { action: 'permission', teamId, uid: 'member-uid', canViewDashboard: true })).status, 200);
  assert.equal(fake.raw(`teams/${teamId}/members/member-uid`).canViewDashboard.booleanValue, true);
  assert.equal((await call(memberToken, { action: 'join', inviteCode: 'ZZZZZZ' })).body.error, 'bad-code');
});

test('② 지표 올리기 — 맥락 키도 받고, 같은 날은 더하고, 기여자 uid는 없다', async () => {
  const { fake, call } = setup();
  const { teamId } = (await call(ownerToken, { action: 'create', name: '팀' })).body;
  const day = { dateKey: '2026-10-26', counts: { refined: 3, misread: 1, decoded: 2, decodeUrgencyGap: 1, urgencyCritical: 1, teamGlossaryApplied: 1, bogus: 9 } };
  const r1 = await call(ownerToken, { action: 'friction', teamId, days: [day] });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.accepted.length, 1);
  assert.equal(r1.body.accepted[0].counts.decoded, 2, '🔴 운영 Functions(옛 배포본)가 버리던 L34 키');
  assert.equal(r1.body.accepted[0].counts.bogus, undefined, '허용 목록 밖은 버린다');
  await call(ownerToken, { action: 'friction', teamId, days: [{ dateKey: '2026-10-26', counts: { refined: 2 } }] });
  const doc = fake.raw(`frictionCounts/${teamId}_2026-10-26`);
  assert.equal(doc.refined.integerValue, '5', 'increment로 더한다');
  assert.equal(doc.decoded.integerValue, '2');
  assert.equal(doc.teamId.stringValue, teamId);
  assert.ok(!JSON.stringify(doc).includes('owner-uid'), '🔴 기여자 uid 없음(필수 9)');
  assert.equal((await call(memberToken, { action: 'friction', teamId, days: [day] })).status, 403, '팀원이 아니면 못 올린다');
});

test('③ 혼자인 팀장 나가기 = 팀·명부·지표 삭제 · 계정 삭제는 Auth 삭제(없는 계정이면 성공)', async () => {
  const { fake, call, authCalls } = setup();
  const { teamId } = (await call(ownerToken, { action: 'create', name: '혼자 팀' })).body;
  await call(ownerToken, { action: 'friction', teamId, days: [{ dateKey: '2026-10-25', counts: { refined: 1 } }, { dateKey: '2026-10-26', counts: { refined: 1 } }] });
  fake.seed(`teams/${teamId}/glossary/g1`, { sourceText: { stringValue: 'x' } });
  const left = await call(ownerToken, { action: 'leave', teamId });
  assert.deepEqual(left, { status: 200, body: { teamId, left: true, teamDeleted: true } });
  assert.deepEqual(fake.names().filter((n) => n.includes(teamId)), [], '팀·명부·용어집·지표 전부');

  const again = (await call(ownerToken, { action: 'create', name: '다시' })).body.teamId;
  fake.seed('users/owner-uid', { tone: { stringValue: 'polite' } });
  fake.seed('refineQuota/owner-uid_2026-10-26', { uid: { stringValue: 'owner-uid' }, count: { integerValue: '3' } });
  const deleted = await call(ownerToken, { action: 'deleteAccount', confirm: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deletedTeams, 1);
  assert.deepEqual(authCalls, ['owner-uid']);
  assert.deepEqual(fake.names().filter((n) => n.includes('owner-uid') || n.includes(again)), []);
  assert.equal((await call(ownerToken, { action: 'deleteAccount' })).body.error, 'not-confirmed');
});

test('④ 거절 모양 — 401 · 400 · 405 · 503 · /health team', async () => {
  const { call, handle } = setup();
  assert.deepEqual(await call(null, { action: 'me', teamId: 't' }), { status: 401, body: { error: 'no-token' } });
  assert.deepEqual(await call(ownerToken, { action: 'nope' }), { status: 400, body: { error: 'unknown action' } });
  const get = await handle(refineRequest(ownerToken, undefined, { method: 'GET', path: '/v1/team' }), TEST_ENV);
  assert.equal(get.status, 405);
  const noStore = setup({ withGoogle: false });
  assert.deepEqual(await noStore.call(ownerToken, { action: 'me', teamId: 't' }), { status: 503, body: { error: 'team-unavailable' } });
  const health = async (h) => (await h(refineRequest(null, undefined, { method: 'GET', path: '/health' }), TEST_ENV)).json();
  assert.equal((await health(handle)).team, 'ready');
  assert.equal((await health(noStore.handle)).team, 'unavailable');
});

test('⑤ 🔴 로그에 팀 이름·이메일·초대 코드가 없다', async () => {
  const { call, logger } = setup();
  const { teamId, inviteCode } = (await call(ownerToken, { action: 'create', name: '비밀프로젝트팀' })).body;
  await call(memberToken, { action: 'join', inviteCode });
  await call(memberToken, { action: 'permission', teamId, uid: 'owner-uid', canViewDashboard: false });
  const all = logger.lines.join('\n');
  assert.ok(logger.lines.length > 0, '거절 로그는 남는다');
  for (const secret of ['비밀프로젝트팀', 'owner@example.com', 'member@example.com', inviteCode]) assert.ok(!all.includes(secret), secret);
});

test('randomInt — 범위 안, 잘못된 max는 거절', () => {
  for (let i = 0; i < 2000; i += 1) {
    const v = randomInt(31);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 31);
  }
  assert.throws(() => randomInt(0), RangeError);
});
