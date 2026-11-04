/**
 * 결제(Groble) — `docs/BillingDesign.md` 0-9 G1~G7. 🔴 네트워크 없음: Groble·Firestore·Claude 모두 가짜.
 * 서명은 node:crypto로 따로 만든다(검증 코드와 같은 규칙인지 확인).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import { resolvePlan } from '../src/billing.js';
import { REF_TTL_MS, parseGrobleOptions, verifyGrobleSignature } from '../src/grobleBilling.js';
import { RestFirestore } from '../src/google/firestoreRest.js';
import { createFakeFirestore } from './fakeFirestore.js';
import { TEST_ENV, captureLogger, fakeAnthropicFetch, makeKeys, signIdToken } from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);
const UID = 'uid-test-123';
const SECRET = 'groble-whsec-test-not-real';
const NOW = Date.now();
const OPTIONS = {
  opt_pro_m: { plan: 'pro', interval: 'month' },
  opt_pro_y: { plan: 'pro', interval: 'year' },
  opt_team2_m: { plan: 'team', interval: 'month', seats: 2 },
  opt_team3_m: { plan: 'team', interval: 'month', seats: 3 },
  opt_team5_m: { plan: 'team', interval: 'month', seats: 5 },
};
const ENV = {
  ...TEST_ENV,
  GROBLE_PRODUCT_PRO: 'prod-pro',
  GROBLE_PRODUCT_TEAM: 'prod-team',
  GROBLE_OPTIONS: JSON.stringify(OPTIONS),
  GROBLE_WEBHOOK_SECRET: SECRET,
};

function setup() {
  const fake = createFakeFirestore();
  const db = new RestFirestore({ projectId: 'sai-global-msg-2026', token: async () => 't', fetchImpl: fake.fetch });
  const logger = captureLogger();
  const handle = createHandler({ jwks: keys.jwks, fetchImpl: fakeAnthropicFetch(), usageStore: createMemoryUsageStore(), cache: new MemoryCacheStore(), logger, now: () => NOW, google: () => ({ db }) });
  return { handle, db, logger };
}

async function seedTeam(db, { teamId = 'team-1', members = [UID, 'u2', 'u3'] } = {}) {
  await db.collection('teams').doc(teamId).set({ name: '테스트 팀', ownerUid: UID });
  for (const [i, uid] of members.entries()) {
    await db.collection('teams').doc(teamId).collection('members').doc(uid).set({ role: uid === UID ? 'owner' : 'member', joinedAt: new Date(Date.UTC(2026, 9, 1 + i)) });
  }
}

function checkout(body) {
  return new globalThis.Request('https://worker.test/v1/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function sigOf(raw, ts, secret = SECRET) {
  return createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
}

function webhook(raw, { ts = String(Math.floor(NOW / 1000)), signature = sigOf(raw, ts), previous, key = null } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Groble-Timestamp': ts };
  if (signature) headers['X-Groble-Signature'] = signature;
  if (previous) headers['X-Groble-Signature-Previous'] = previous;
  if (key) headers['X-Groble-Idempotency-Key'] = key;
  return new globalThis.Request('https://worker.test/v1/billing/groble-webhook', { method: 'POST', headers, body: raw });
}

let seq = 0;
function event(type, object, { occurredAt = new Date(NOW).toISOString() } = {}) {
  seq += 1;
  return { id: `evt_${seq}`, type, version: 1, occurredAt, data: { object } };
}

function paid(ref, { optionId = 'opt_pro_m', merchantUid = `m_${seq + 1}`, purchasedAt = new Date(NOW).toISOString(), cycle = 1, next = '2026-12-04', reason = 'INITIAL' } = {}) {
  return {
    merchantUid,
    sellerReference: ref,
    buyer: { type: 'MEMBER', displayName: '구매자', email: 'buyer@example.com', phoneNumber: '010-0000-0000' },
    paymentMethod: { type: 'CARD', cardName: '테스트카드', maskedCardNumber: '1234-****' },
    options: [{ optionId, name: '옵션', quantity: 1 }],
    pricing: { currency: 'KRW', finalAmount: 7900 },
    payment: { purchasedAt },
    subscription: { billingReason: reason, currentRound: 1, nextBillingDate: next, status: 'ACTIVE', billingCycleMonths: cycle },
  };
}

async function send(handle, ev, opts = {}) {
  const raw = JSON.stringify(ev);
  return handle(webhook(raw, opts), ENV);
}

async function startCheckout(handle, body = { plan: 'pro', interval: 'month' }) {
  const res = await handle(checkout(body), ENV);
  const out = await res.json();
  return { res, out, ref: out.checkoutUrl ? new URL(out.checkoutUrl).searchParams.get('ref') : null };
}

async function docOf(db, col, id) {
  const snap = await db.collection(col).doc(id).get();
  return snap.exists ? snap.data() : null;
}

test('결제 시작 — Groble 링크·토큰(uid 없음)·토큰 저장, 로그인 없으면 401, 모르는 요금제 400', async () => {
  const { handle, db } = setup();
  const { res, out, ref } = await startCheckout(handle);
  assert.equal(res.status, 200);
  assert.match(out.checkoutUrl, /^https:\/\/groble\.im\/payment\/prod-pro\?ref=sr_[A-Za-z0-9_-]{32}$/);
  assert.ok(!out.checkoutUrl.includes(UID), '🔴 링크에 uid가 실렸다');
  const saved = await docOf(db, 'billingRefs', ref);
  assert.equal(saved.uid, UID);
  assert.equal(saved.plan, 'pro');
  assert.equal(saved.boundAt, null);

  const anon = await handle(new globalThis.Request('https://worker.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"plan":"pro","interval":"month"}' }), ENV);
  assert.equal(anon.status, 401);
  assert.equal((await startCheckout(handle, { plan: 'gold', interval: 'month' })).res.status, 400);
  assert.equal((await startCheckout(handle, { plan: 'pro', interval: 'week' })).res.status, 400);
});

test('G1 — 서명이 맞는 웹훅만: 틀림·없음·±5분 밖·다른 비밀값은 401·쓰기 0, Previous 헤더도 받음', async () => {
  const base = setup();
  const { ref } = await startCheckout(base.handle);
  const raw = JSON.stringify(event('subscription_payment.completed', paid(ref)));
  const ts = String(Math.floor(NOW / 1000));
  for (const [label, opts] of [
    ['서명 없음', { signature: null }],
    ['다른 비밀값', { signature: sigOf(raw, ts, 'other') }],
    ['6분 전 시각', { ts: String(Math.floor(NOW / 1000) - 360), signature: sigOf(raw, String(Math.floor(NOW / 1000) - 360)) }],
    ['시각 헤더 바꿈', { ts: String(Math.floor(NOW / 1000) + 1), signature: sigOf(raw, ts) }],
  ]) {
    const res = await base.handle(webhook(raw, opts), ENV);
    assert.equal(res.status, 401, label);
    assert.equal(await docOf(base.db, 'billing', UID), null, `${label} — 쓰면 안 된다`);
  }
  const res = await base.handle(webhook(raw, { signature: sigOf(raw, ts, 'old-secret'), previous: sigOf(raw, ts) }), ENV);
  assert.equal(res.status, 200, '비밀값 교체 직후 — Previous 서명이 지금 비밀값과 맞으면 받는다');
  assert.equal((await docOf(base.db, 'billing', UID)).status, 'active');

  // 밀리초 시각도 받는다(❓ 단위 미확인 대비).
  assert.equal(await verifyGrobleSignature('x', { timestamp: String(NOW), signature: sigOf('x', String(NOW)) }, SECRET, NOW), true);
  const off = setup();
  const res503 = await off.handle(webhook(raw), { ...ENV, GROBLE_WEBHOOK_SECRET: undefined });
  assert.equal(res503.status, 503, '비밀값이 없으면 지어낸 성공 없이 503');
});

test('G2 — 같은 멱등 키 두 번이면 두 번째는 쓰기 0 · 늦게 온 옛 이벤트는 덮지 않음', async () => {
  const { handle, db } = setup();
  const { ref } = await startCheckout(handle);
  await send(handle, event('subscription_payment.completed', paid(ref), { occurredAt: '2026-11-04T01:00:00Z' }), { key: 'idem-1' });
  await send(handle, event('subscription.terminated', { merchantUid: 'mx', sellerReference: ref, termination: { terminatedAt: '2026-11-04T02:00:00Z' }, subscription: { status: 'CANCELLED' } }, { occurredAt: '2026-11-04T02:00:00Z' }), { key: 'idem-2' });
  assert.equal((await docOf(db, 'billing', UID)).status, 'canceled');
  // 같은 키 재전송 — 이번엔 내용이 달라도(가정) 무시되어야 한다.
  await send(handle, event('subscription_payment.completed', paid(ref, { reason: 'RENEWAL' }), { occurredAt: '2026-11-04T03:00:00Z' }), { key: 'idem-1' });
  assert.equal((await docOf(db, 'billing', UID)).status, 'canceled', '🔴 이미 처리한 멱등 키가 다시 반영됐다');
  // 새 키지만 옛 시각 — stale.
  await send(handle, event('subscription_payment.completed', paid(ref, { reason: 'RENEWAL' }), { occurredAt: '2026-11-04T01:30:00Z' }), { key: 'idem-3' });
  assert.equal((await docOf(db, 'billing', UID)).status, 'canceled', '🔴 늦게 도착한 옛 결제가 해지를 되돌렸다');
});

test('G3 — 바꾼 ref·옵션 불일치·24시간 지난 토큰은 쓰기 0, 결제는 24시간 안인데 늦게 온 웹훅은 처리', async () => {
  const { handle, db, logger } = setup();
  const { ref } = await startCheckout(handle);
  const cases = [
    ['없는 토큰', paid('sr_' + 'A'.repeat(32))],
    ['형식 다른 ref(uid 직접)', paid(UID)],
    ['Pro 토큰으로 팀 옵션', paid(ref, { optionId: 'opt_team2_m' })],
    ['표에 없는 옵션', paid(ref, { optionId: 'opt_unknown' })],
    ['주기 값이 옵션과 다름', paid(ref, { cycle: 12 })],
    ['24시간 지난 결제', paid(ref, { purchasedAt: new Date(NOW + REF_TTL_MS + 60_000).toISOString() })],
  ];
  for (const [label, obj] of cases) {
    const res = await send(handle, event('subscription_payment.completed', obj));
    assert.equal(res.status, 200, `${label} — 다시 보내도 같으므로 200`);
    assert.equal(await docOf(db, 'billing', UID), null, `${label} — 쓰면 안 된다`);
  }
  assert.equal((await docOf(db, 'billingRefs', ref)).boundAt, null);
  assert.ok(logger.lines.some((l) => l.includes('unknown-ref')) && logger.lines.some((l) => l.includes('wrong-option')) && logger.lines.some((l) => l.includes('expired-ref')));
  // 결제는 23시간 뒤(유효), 웹훅 도착은 그보다 훨씬 뒤 — 결제 시각으로 판정하므로 처리.
  const late = event('subscription_payment.completed', paid(ref, { purchasedAt: new Date(NOW + 23 * 3600_000).toISOString() }), { occurredAt: new Date(NOW + 23 * 3600_000).toISOString() });
  await send(handle, late);
  assert.equal((await docOf(db, 'billing', UID)).status, 'active');
  // 묶이지 않은 토큰에 해지 이벤트만 오면 무시.
  const other = setup();
  const t2 = await startCheckout(other.handle);
  await send(other.handle, event('subscription.cancel_requested', { merchantUid: 'm', sellerReference: t2.ref }));
  assert.equal(await docOf(other.db, 'billing', UID), null);
});

test('G4 — 이벤트 판정표: 결제 → Pro, 실패 → 재청구 중 유지, 해지 요청 → 예약, 해지 → 끝, 환불 → 바로 끔(merchantUid로 찾음)', async () => {
  const { handle, db } = setup();
  const { ref } = await startCheckout(handle);
  const at = (h) => `2026-11-04T0${h}:00:00Z`;
  await send(handle, event('subscription_payment.completed', paid(ref, { merchantUid: 'round-1' }), { occurredAt: at(1) }));
  let doc = await docOf(db, 'billing', UID);
  assert.equal(doc.status, 'active');
  assert.equal(doc.periodEnd, '2026-12-04');
  assert.equal(doc.provider, 'groble');
  assert.equal(doc.interval, 'month');
  assert.equal(resolvePlan(doc, { enforced: true }), 'pro');
  assert.equal((await docOf(db, 'billingRounds', 'round-1')).ref, ref);

  await send(handle, event('subscription_payment.failed', { merchantUid: 'try-1', sellerReference: ref, failure: { isFinal: false, attemptNumber: 1 }, subscription: { status: 'PAST_DUE' } }, { occurredAt: at(2) }));
  doc = await docOf(db, 'billing', UID);
  assert.equal(doc.status, 'past_due');
  assert.equal(resolvePlan(doc, { enforced: true }), 'pro', '재청구 중에는 Pro 유지');

  await send(handle, event('subscription_payment.failed', { merchantUid: 'try-2', sellerReference: ref, failure: { isFinal: true, gracePeriodEndsAt: '2026-11-11T00:00:00Z' }, subscription: { status: 'PAST_DUE' } }, { occurredAt: at(3) }));
  assert.equal((await docOf(db, 'billing', UID)).graceEnd, '2026-11-11T00:00:00Z');

  await send(handle, event('subscription_payment.completed', paid(ref, { merchantUid: 'round-2', reason: 'RENEWAL' }), { occurredAt: at(4) }));
  await send(handle, event('subscription.cancel_requested', { merchantUid: 'round-2', sellerReference: ref, subscription: { status: 'CANCELLED' } }, { occurredAt: at(5) }));
  doc = await docOf(db, 'billing', UID);
  assert.equal(doc.status, 'active', '해지 요청은 기간 끝까지 유지');
  assert.equal(doc.cancelScheduled, true);

  // 환불 — sellerReference 없음, merchantUid로 찾는다. 바로 끈다(2026-11-04 사용자 결정).
  await send(handle, event('subscription_payment.refunded', { merchantUid: 'round-2', refund: { amount: 7900, partialRefund: false, refundedAt: '2026-11-04T06:00:00Z' }, subscription: { status: 'ACTIVE' } }, { occurredAt: at(6) }));
  doc = await docOf(db, 'billing', UID);
  assert.equal(doc.status, 'canceled');
  assert.equal(resolvePlan(doc, { enforced: true }), 'free');
  assert.ok(doc.expireAt, '끝난 기록은 5년 보관 만료가 적힌다');

  await send(handle, event('subscription.terminated', { merchantUid: 'round-2', sellerReference: ref, termination: { terminatedAt: '2026-11-04T07:00:00Z' }, subscription: { status: 'CANCELLED' } }, { occurredAt: at(7) }));
  assert.equal((await docOf(db, 'billing', UID)).status, 'canceled');

  // 모르는 회차의 환불·단건 결제 이벤트는 무시.
  assert.equal((await send(handle, event('subscription_payment.refunded', { merchantUid: 'nope' }))).status, 200);
  assert.equal((await send(handle, event('payment.completed', paid(ref)))).status, 200);
});

test('G5 — 팀: 팀장만 · 좌석 2~10 · 팀원 수 이상, 옵션 좌석이 최소보다 적으면 거절, 맞으면 팀 기록·좌석 배정', async () => {
  const { handle, db } = setup();
  await seedTeam(db);
  assert.equal((await startCheckout(handle, { plan: 'team', interval: 'month', teamId: 'team-1', seats: 11 })).res.status, 400);
  assert.equal((await startCheckout(handle, { plan: 'team', interval: 'month', teamId: 'team-1', seats: 2 })).res.status, 400, '팀원 3명인데 2석');
  const { res, out, ref } = await startCheckout(handle, { plan: 'team', interval: 'month', teamId: 'team-1', seats: 3 });
  assert.equal(res.status, 200);
  assert.match(out.checkoutUrl, /\/payment\/prod-team\?ref=/);

  await send(handle, event('subscription_payment.completed', paid(ref, { optionId: 'opt_team2_m' })));
  assert.equal((await docOf(db, 'teams', 'team-1')).billing, undefined, '2석 옵션 — 최소 3석보다 적다');

  await send(handle, event('subscription_payment.completed', paid(ref, { optionId: 'opt_team5_m', merchantUid: 'team-round' })));
  const team = await docOf(db, 'teams', 'team-1');
  assert.equal(team.billing.status, 'active');
  assert.equal(team.billing.seats, 5);
  assert.equal(team.billing.payerUid, UID);
  assert.equal(team.locked, false);
  for (const uid of [UID, 'u2', 'u3']) assert.equal((await docOf(db, 'billing', uid)).teamSeat.paid, true, `${uid} 좌석`);
  assert.equal(resolvePlan(await docOf(db, 'billing', 'u2'), { enforced: true }), 'team');
  assert.equal((await docOf(db, 'billing', UID)).teamPurchase.status, 'active');

  // 팀원이 아니면(팀장 아님) 403.
  const other = setup();
  await seedTeam(other.db, { members: ['someone', UID] });
  await other.db.collection('teams').doc('team-1').set({ ownerUid: 'someone' }, { merge: true });
  await other.db.collection('teams').doc('team-1').collection('members').doc(UID).set({ role: 'member' }, { merge: true });
  assert.equal((await startCheckout(other.handle, { plan: 'team', interval: 'month', teamId: 'team-1', seats: 2 })).res.status, 403);

  // 환불 → 팀 좌석 해제.
  await send(handle, event('subscription_payment.refunded', { merchantUid: 'team-round', refund: { refundedAt: new Date(NOW).toISOString() } }, { occurredAt: new Date(NOW + 1000).toISOString() }));
  assert.equal((await docOf(db, 'teams', 'team-1')).billing.status, 'canceled');
  for (const uid of [UID, 'u2', 'u3']) assert.equal((await docOf(db, 'billing', uid)).teamSeat.paid, false, `${uid} 좌석 해제`);
  assert.equal(resolvePlan(await docOf(db, 'billing', 'u2'), { enforced: true }), 'free');
});

test('G5 — 이미 결제 중이면 결제 시작 409(Groble 경로도)', async () => {
  const { handle, db } = setup();
  const { ref } = await startCheckout(handle);
  await send(handle, event('subscription_payment.completed', paid(ref)));
  assert.equal((await startCheckout(handle)).res.status, 409);
});

test('G6 — 저장·로그·응답에 구매자 이메일·전화·이름·카드·uid(로그) 없음', async () => {
  const { handle, db, logger } = setup();
  const { ref } = await startCheckout(handle);
  const res = await send(handle, event('subscription_payment.completed', paid(ref)));
  const body = await res.text();
  const stored = JSON.stringify([await docOf(db, 'billing', UID), await docOf(db, 'billingRefs', ref)]);
  for (const secretish of ['buyer@example.com', '010-0000-0000', '구매자', '1234-****', '테스트카드', SECRET]) {
    assert.ok(!stored.includes(secretish), `🔴 저장소에 ${secretish}`);
    assert.ok(!body.includes(secretish), `🔴 응답에 ${secretish}`);
    assert.ok(!logger.lines.join('\n').includes(secretish), `🔴 로그에 ${secretish}`);
  }
  assert.ok(!logger.lines.join('\n').includes(UID), '🔴 로그에 uid');
});

test('G7 — 옵션 표: 틀린 줄은 버리고, Groble 설정이 없으면 결제 시작은 예전(Paddle) 경로 그대로', async () => {
  const map = parseGrobleOptions(JSON.stringify({ a: { plan: 'pro', interval: 'month' }, b: { plan: 'team', interval: 'year', seats: 11 }, c: { plan: 'team', interval: 'week', seats: 3 }, d: { plan: 'gold' } }));
  assert.deepEqual([...map.keys()], ['a']);
  assert.equal(parseGrobleOptions('not json').size, 0);
  const { handle } = setup();
  const res = await handle(checkout({ plan: 'pro', interval: 'month' }), TEST_ENV);
  assert.equal(res.status, 503, 'Groble도 Paddle도 설정이 없으면 503');
});
