/**
 * 팀 요금제 — `docs/BillingDesign.md` 8-2 TP1~TP3. 🔴 네트워크 없음: Paddle·Firestore·Claude 모두 가짜.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import { PLAN_LIMITS, resolvePlan, syncTeamSeats } from '../src/billing.js';
import { RestFirestore } from '../src/google/firestoreRest.js';
import { createFakeFirestore } from './fakeFirestore.js';
import { BASE_BODY, TEST_ENV, captureLogger, fakeAnthropicFetch, makeKeys, refineRequest, signIdToken } from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);
const UID = 'uid-test-123';
const SECRET = 'whsec-test-not-real';
const ENV = {
  ...TEST_ENV,
  PADDLE_ENV: 'sandbox',
  PADDLE_API_KEY: 'pdl-test-key-not-real',
  PADDLE_WEBHOOK_SECRET: SECRET,
  PADDLE_PRICE_PRO_MONTH: 'pri_pro_m',
  PADDLE_PRICE_PRO_YEAR: 'pri_pro_y',
  PADDLE_PRICE_TEAM_MONTH: 'pri_team_m',
  PADDLE_PRICE_TEAM_YEAR: 'pri_team_y',
};
const NOW = Date.now();

function sign(raw) {
  const ts = Math.floor(NOW / 1000);
  return `ts=${ts};h1=${createHmac('sha256', SECRET).update(`${ts}:${raw}`).digest('hex')}`;
}

/** 팀 하나 + 팀원(참가 순서대로). */
async function seedTeam(db, { teamId = 'team-1', ownerUid = UID, members = [UID, 'u2', 'u3'] } = {}) {
  await db.collection('teams').doc(teamId).set({ name: '테스트 팀', ownerUid });
  for (const [i, uid] of members.entries()) {
    await db
      .collection('teams')
      .doc(teamId)
      .collection('members')
      .doc(uid)
      .set({ role: uid === ownerUid ? 'owner' : 'member', joinedAt: new Date(Date.UTC(2026, 9, 1 + i)) });
  }
}

function setup({ fetchImpl = fakeAnthropicFetch(), usageStore = createMemoryUsageStore() } = {}) {
  const fake = createFakeFirestore();
  const db = new RestFirestore({ projectId: 'sai-global-msg-2026', token: async () => 't', fetchImpl: fake.fetch });
  const logger = captureLogger();
  const handle = createHandler({ jwks: keys.jwks, fetchImpl, usageStore, cache: new MemoryCacheStore(), logger, now: () => NOW, google: () => ({ db }) });
  return { handle, db, logger };
}

function fakePaddle() {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return new globalThis.Response(JSON.stringify({ data: { id: 'txn_t', checkout: { url: 'https://site.test/checkout?_ptxn=txn_t' } } }), { status: 201 });
  };
  impl.seen = seen;
  return impl;
}

function checkout(body) {
  return new globalThis.Request('https://worker.test/v1/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${TEST_ENV.EXTENSION_ID}`, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test('TP1 — 팀장만 팀 결제 시작, 좌석은 max(2, 팀원 수) 이상, 거래에 teamId·수량', async () => {
  const paddle = fakePaddle();
  const { handle, db } = setup({ fetchImpl: paddle });
  await seedTeam(db);
  await seedTeam(db, { teamId: 'team-other', ownerUid: 'someone-else', members: ['someone-else', UID] });

  assert.equal((await handle(checkout({ plan: 'team', interval: 'month', teamId: 'team-other', seats: 5 }), ENV)).status, 403);
  assert.equal((await handle(checkout({ plan: 'team', interval: 'month', teamId: 'team-1', seats: 1 }), ENV)).status, 400, '최소 2석');
  assert.equal((await handle(checkout({ plan: 'team', interval: 'month', teamId: 'team-1', seats: 2 }), ENV)).status, 400, '팀원 3명보다 적다');
  assert.equal((await handle(checkout({ plan: 'team', interval: 'month', teamId: 'team-1', seats: 101 }), ENV)).status, 400);
  assert.equal((await handle(checkout({ plan: 'team', interval: 'week', teamId: 'team-1', seats: 3 }), ENV)).status, 400);
  assert.equal((await handle(checkout({ plan: 'team', interval: 'year', teamId: 'no-such', seats: 3 }), ENV)).status, 403);

  const ok = await handle(checkout({ plan: 'team', interval: 'year', teamId: 'team-1', seats: 3 }), ENV);
  assert.equal(ok.status, 200);
  const sent = paddle.seen.at(-1).body;
  assert.deepEqual(sent.items, [{ price_id: 'pri_team_y', quantity: 3 }]);
  assert.deepEqual(sent.custom_data, { uid: UID, teamId: 'team-1' });
});

function teamEvent({ status = 'active', seats = 2, occurred = '2026-11-01T01:00:00Z', teamId = 'team-1' } = {}) {
  return {
    event_type: 'subscription.created',
    occurred_at: occurred,
    data: {
      id: 'sub_team',
      status,
      customer_id: 'ctm_team',
      custom_data: { uid: UID, teamId },
      items: [{ price: { id: 'pri_team_m' }, quantity: seats }],
      billing_cycle: { interval: 'month' },
      current_billing_period: { ends_at: '2026-12-01T00:00:00Z' },
    },
  };
}

async function webhook(handle, event) {
  const raw = JSON.stringify(event);
  return handle(
    new globalThis.Request('https://worker.test/v1/billing/webhook', { method: 'POST', headers: { 'Paddle-Signature': sign(raw) }, body: raw }),
    ENV,
  );
}

const seatOf = async (db, uid) => (await db.collection('billing').doc(uid).get()).data()?.teamSeat ?? null;

test('TP2 — 팀 웹훅이 팀 문서에 기록하고, 참가 순서대로 좌석 N개(넘친 팀원은 좌석 없음)', async () => {
  const { handle, db } = setup();
  await seedTeam(db);
  assert.equal((await webhook(handle, teamEvent({ seats: 2 }))).status, 200);
  const team = (await db.collection('teams').doc('team-1').get()).data();
  assert.deepEqual([team.billing.status, team.billing.seats, team.billing.priceId], ['active', 2, 'pri_team_m']);
  assert.deepEqual(await seatOf(db, UID), { teamId: 'team-1', paid: true });
  assert.deepEqual(await seatOf(db, 'u2'), { teamId: 'team-1', paid: true });
  assert.deepEqual(await seatOf(db, 'u3'), { teamId: 'team-1', paid: false }, '세 번째로 들어온 사람은 좌석 밖');

  // 해지되면 모두 좌석 해제. 옛 이벤트는 덮지 않는다.
  await webhook(handle, teamEvent({ status: 'canceled', occurred: '2026-11-01T02:00:00Z' }));
  assert.equal((await seatOf(db, UID)).paid, false);
  await webhook(handle, teamEvent({ status: 'active', occurred: '2026-11-01T01:30:00Z' }));
  assert.equal((await seatOf(db, UID)).paid, false, '🔴 늦게 온 옛 이벤트가 해지를 되돌렸다');

  // 없는 팀 이벤트는 무시(쓰기 없음).
  assert.equal((await webhook(handle, teamEvent({ teamId: 'ghost' }))).status, 200);
  assert.equal((await db.collection('teams').doc('ghost').get()).exists, false);
});

test('syncTeamSeats — 좌석이 팀원보다 많으면 전원, 결제 아님이면 0', async () => {
  const { db } = setup();
  await seedTeam(db);
  await db.collection('teams').doc('team-1').set({ billing: { status: 'active', seats: 10 } }, { merge: true });
  assert.deepEqual(await syncTeamSeats(db, 'team-1'), { seated: 3, unseated: 0 });
  await db.collection('teams').doc('team-1').set({ billing: { status: 'paused', seats: 10 } }, { merge: true });
  assert.deepEqual(await syncTeamSeats(db, 'team-1'), { seated: 0, unseated: 3 });
});

test('TP3 — 좌석 팀원 = 팀 한도(200·기본 20·심층 5), 좌석 밖은 개인 요금제, 개인 Pro와 겹치면 팀', async () => {
  const prices = { month: 'pri_pro_m', year: 'pri_pro_y' };
  assert.equal(resolvePlan({ teamSeat: { teamId: 't', paid: true } }, { prices }), 'team');
  assert.equal(resolvePlan({ teamSeat: { teamId: 't', paid: false } }, { prices, enforced: true }), 'free');
  assert.equal(resolvePlan({ status: 'active', priceId: 'pri_pro_m', teamSeat: { paid: true } }, { prices }), 'team');
  assert.equal(resolvePlan({ status: 'active', priceId: 'pri_pro_m', teamSeat: { paid: false } }, { prices }), 'pro');
  assert.deepEqual({ ...PLAN_LIMITS.team }, { daily: 200, standard: 20, deep: 5 });

  const store = createMemoryUsageStore();
  store.setBilling(UID, { teamSeat: { teamId: 'team-1', paid: true } });
  const { handle } = setup({ usageStore: store });
  const enforced = { ...ENV, BILLING_ENFORCED: '1' };
  const refine = async () => (await (await handle(refineRequest(token, { ...BASE_BODY, text: `${BASE_BODY.text} ${Math.random()}`, quality: 'standard' }), enforced)).json());
  for (let i = 0; i < 20; i += 1) assert.equal((await refine()).quality, 'standard', `${i + 1}번째`);
  const over = await refine();
  assert.deepEqual([over.quality, over.qualityDowngrade], ['fast', 'daily']);
});
