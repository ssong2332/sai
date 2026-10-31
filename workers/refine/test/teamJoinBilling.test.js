/**
 * 팀 요금제 2단계 — 참가 차단·베타 유예·좌석 재배정 (`docs/BillingDesign.md` 8-2 TP4).
 * 판정은 `functions/teams.js` judgeTeamJoin(순수), 배선은 Worker `/v1/team`. 🔴 네트워크 없음.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { judgeTeamJoin, TEAM_GRACE_DAYS } from '../../../functions/teams.js';
import { createHandler } from '../src/handler.js';
import { RestFirestore } from '../src/google/firestoreRest.js';
import { createNoopUsageStore } from '../src/usageStore.js';
import { createFakeFirestore } from './fakeFirestore.js';
import { TEST_ENV, captureLogger, makeKeys, refineRequest, signIdToken } from './helpers.js';

const DAY = 86_400_000;
const LAUNCH = Date.UTC(2026, 11, 1);

test('judgeTeamJoin 판정표 — 꽉 참·결제·베타·출시 시각 모름·유예·미결제', () => {
  const paid = { status: 'active', seats: 3 };
  assert.equal(judgeTeamJoin({ billing: paid, memberCount: 3 }), 'team-full');
  assert.equal(judgeTeamJoin({ billing: paid, memberCount: 2, enforced: true, enforcedAtMs: LAUNCH }), null);
  assert.equal(judgeTeamJoin({ billing: null, memberCount: 50, enforced: false }), null, '베타는 지금 그대로');
  assert.equal(judgeTeamJoin({ billing: null, enforced: true, enforcedAtMs: NaN }), null, '🔴 출시 시각을 모르면 잠그지 않는다');
  const before = LAUNCH - 10 * DAY;
  assert.equal(judgeTeamJoin({ billing: null, createdAtMs: before, enforced: true, enforcedAtMs: LAUNCH, nowMs: LAUNCH + 29 * DAY }), null, '유예 안');
  assert.equal(
    judgeTeamJoin({ billing: null, createdAtMs: before, enforced: true, enforcedAtMs: LAUNCH, nowMs: LAUNCH + TEAM_GRACE_DAYS * DAY + 1 }),
    'team-plan-required',
    '유예 끝',
  );
  assert.equal(judgeTeamJoin({ billing: null, createdAtMs: LAUNCH + DAY, enforced: true, enforcedAtMs: LAUNCH, nowMs: LAUNCH + 2 * DAY }), 'team-plan-required', '출시 뒤 만든 팀은 유예 없음');
  assert.equal(judgeTeamJoin({ billing: { status: 'canceled', seats: 9 }, memberCount: 1, enforced: true, enforcedAtMs: LAUNCH, nowMs: LAUNCH + 40 * DAY, createdAtMs: before }), 'team-plan-required');
});

const keys = await makeKeys();
const ownerToken = await signIdToken(keys, { sub: 'owner-uid', email: 'owner@example.com' });
const aToken = await signIdToken(keys, { sub: 'a-uid', email: 'a@example.com' });
const bToken = await signIdToken(keys, { sub: 'b-uid', email: 'b@example.com' });

function setup() {
  const fake = createFakeFirestore();
  const db = new RestFirestore({ projectId: TEST_ENV.FIREBASE_PROJECT_ID, token: async () => 't', fetchImpl: fake.fetch });
  const google = { db, tokenSource: { token: async () => 't' }, projectId: TEST_ENV.FIREBASE_PROJECT_ID, fetchImpl: fake.fetch };
  const handle = createHandler({ jwks: keys.jwks, usageStore: createNoopUsageStore(), google: () => google, logger: captureLogger() });
  const call = async (token, body, env = TEST_ENV) => {
    const res = await handle(refineRequest(token, body, { path: '/v1/team' }), env);
    return { status: res.status, body: await res.json() };
  };
  return { db, call };
}

const seat = async (db, uid) => (await db.collection('billing').doc(uid).get()).data()?.teamSeat ?? null;

test('TP4 — 결제된 팀(2석): 둘째는 좌석, 셋째는 409 team-full · 팀원을 내보내면 좌석 해제 후 빈자리에 참가 가능', async () => {
  const { db, call } = setup();
  const { teamId, inviteCode } = (await call(ownerToken, { action: 'create', name: '결제 팀' })).body;
  await db.collection('teams').doc(teamId).set({ billing: { status: 'active', seats: 2 } }, { merge: true });

  assert.equal((await call(aToken, { action: 'join', inviteCode })).status, 200);
  assert.deepEqual(await seat(db, 'a-uid'), { teamId, paid: true }, '참가하면 좌석 재배정');
  const full = await call(bToken, { action: 'join', inviteCode });
  assert.deepEqual([full.status, full.body.error], [409, 'team-full']);
  assert.equal((await call(aToken, { action: 'join', inviteCode })).status, 200, '이미 팀원이면 재참가는 막지 않는다');

  assert.equal((await call(ownerToken, { action: 'kick', teamId, uid: 'a-uid' })).status, 200);
  assert.deepEqual(await seat(db, 'a-uid'), { teamId, paid: false }, '내보내면 좌석 해제');
  assert.equal((await call(bToken, { action: 'join', inviteCode })).status, 200);
  assert.deepEqual(await seat(db, 'b-uid'), { teamId, paid: true });
});

test('TP4 — 유료 출시 뒤 미결제 팀(유예 끝·출시 뒤 생성)은 409 team-plan-required, 출시 전(꺼짐)은 지금 그대로', async () => {
  const { db, call } = setup();
  const { teamId, inviteCode } = (await call(ownerToken, { action: 'create', name: '무료 팀' })).body;
  assert.equal((await call(aToken, { action: 'join', inviteCode })).status, 200, '꺼짐 — 베타 그대로');

  // 가짜 Firestore 시계로 팀 생성 = 2026-10-26. 출시를 그 전(10-20)으로 두면 「출시 뒤 만든 팀」 — 유예 없음.
  const enforced = { ...TEST_ENV, BILLING_ENFORCED: '1', BILLING_ENFORCED_AT: '2026-10-20T00:00:00Z' };
  const blocked = await call(bToken, { action: 'join', inviteCode }, enforced);
  assert.deepEqual([blocked.status, blocked.body.error], [409, 'team-plan-required']);
  assert.equal((await db.collection('teams').doc(teamId).collection('members').doc('b-uid').get()).exists, false, '막히면 아무것도 쓰지 않는다');

  // 출시(10-30)가 팀 생성(10-26)보다 뒤이고 지금이 출시 + 30일 안이면 통과(유예).
  const graceEnv = { ...TEST_ENV, BILLING_ENFORCED: '1', BILLING_ENFORCED_AT: new Date(Date.now() - DAY).toISOString() };
  assert.equal((await call(bToken, { action: 'join', inviteCode }, graceEnv)).status, 200);
});
