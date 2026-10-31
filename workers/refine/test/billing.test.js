/**
 * 결제(Paddle) — `docs/BillingDesign.md` 4절 P1~P6. 🔴 네트워크 없음: Paddle·Firestore·Claude 모두 가짜.
 * 서명은 실제 HMAC-SHA256으로 만든다(검증 코드를 그대로 탄다).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { QUALITY_MODES } from '../../../src/core/refine/quality.js';
import { createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import { resolvePlan, verifyPaddleSignature } from '../src/billing.js';
import { RestFirestore } from '../src/google/firestoreRest.js';
import { createFakeFirestore } from './fakeFirestore.js';
import { BASE_BODY, TEST_ENV, captureLogger, fakeAnthropicFetch, makeKeys, refineRequest, signIdToken } from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);
const UID = 'uid-test-123';
const SECRET = 'whsec-test-not-real';
const API_KEY = 'pdl-test-key-not-real';
const PRICES = { PADDLE_PRICE_PRO_MONTH: 'pri_month_test', PADDLE_PRICE_PRO_YEAR: 'pri_year_test' };
const BILLING_ENV = { ...TEST_ENV, PADDLE_ENV: 'sandbox', PADDLE_API_KEY: API_KEY, PADDLE_WEBHOOK_SECRET: SECRET, ...PRICES };
const NOW = Date.now();

function sign(raw, { secret = SECRET, ts = Math.floor(NOW / 1000) } = {}) {
  return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex')}`;
}

function subEvent({ type = 'subscription.created', status = 'active', priceId = 'pri_month_test', occurred = '2026-10-31T11:00:00Z', uid = UID } = {}) {
  return {
    event_id: 'evt_test',
    event_type: type,
    occurred_at: occurred,
    data: {
      id: 'sub_test',
      status,
      customer_id: 'ctm_test',
      custom_data: uid === undefined ? undefined : { uid },
      items: [{ price: { id: priceId } }],
      billing_cycle: { interval: 'month', frequency: 1 },
      current_billing_period: { starts_at: '2026-10-31T00:00:00Z', ends_at: '2026-11-30T00:00:00Z' },
    },
  };
}

function setup({ fetchImpl = fakeAnthropicFetch(), usageStore = createMemoryUsageStore() } = {}) {
  const fake = createFakeFirestore();
  const db = new RestFirestore({ projectId: 'sai-global-msg-2026', token: async () => 't', fetchImpl: fake.fetch });
  const logger = captureLogger();
  const handle = createHandler({
    jwks: keys.jwks,
    fetchImpl,
    usageStore,
    cache: new MemoryCacheStore(),
    logger,
    now: () => NOW,
    google: () => ({ db }),
  });
  return { handle, db, logger, fake };
}

function webhook(raw, signature) {
  return new globalThis.Request('https://worker.test/v1/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature ? { 'Paddle-Signature': signature } : {}) },
    body: raw,
  });
}

async function billingDoc(db) {
  const snap = await db.collection('billing').doc(UID).get();
  return snap.exists ? snap.data() : null;
}

test('P1 — 서명이 맞으면 200·기록, 틀림·없음·5분 넘은 시각·다른 비밀값은 401·쓰기 0', async () => {
  const raw = JSON.stringify(subEvent());
  for (const [label, signature] of [
    ['없음', null],
    ['다른 비밀값', sign(raw, { secret: 'other' })],
    ['본문 바뀜', sign(raw.replace('active', 'paused'))],
    ['6분 전 시각', sign(raw, { ts: Math.floor(NOW / 1000) - 360 })],
    ['형식 깨짐', 'ts=abc;h1='],
  ]) {
    const { handle, db } = setup();
    const res = await handle(webhook(raw, signature), BILLING_ENV);
    assert.equal(res.status, 401, label);
    assert.equal(await billingDoc(db), null, `${label} — 쓰면 안 된다`);
  }
  const { handle, db } = setup();
  const res = await handle(webhook(raw, sign(raw)), BILLING_ENV);
  assert.equal(res.status, 200);
  assert.equal((await billingDoc(db)).status, 'active');
});

test('P1 — 웹훅 비밀값이 없으면 503 billing-unavailable(지어낸 성공 없음)', async () => {
  const { handle } = setup();
  const raw = JSON.stringify(subEvent());
  const env = { ...BILLING_ENV, PADDLE_WEBHOOK_SECRET: undefined };
  const res = await handle(webhook(raw, sign(raw)), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'billing-unavailable');
});

test('P2 — created → 해지 반영, 더 오래된 이벤트는 덮지 않음, 구독 아닌 이벤트·uid 없음은 무시', async () => {
  const { handle, db } = setup();
  const send = async (event) => {
    const raw = JSON.stringify(event);
    return handle(webhook(raw, sign(raw)), BILLING_ENV);
  };
  await send(subEvent({ occurred: '2026-10-31T11:00:00Z' }));
  assert.equal((await billingDoc(db)).priceId, 'pri_month_test');
  await send(subEvent({ type: 'subscription.canceled', status: 'canceled', occurred: '2026-10-31T11:30:00Z' }));
  assert.equal((await billingDoc(db)).status, 'canceled');
  await send(subEvent({ type: 'subscription.updated', status: 'active', occurred: '2026-10-31T11:10:00Z' }));
  assert.equal((await billingDoc(db)).status, 'canceled', '🔴 늦게 도착한 옛 이벤트가 해지를 되돌렸다');

  const other = setup();
  const raw1 = JSON.stringify({ ...subEvent(), event_type: 'transaction.completed' });
  assert.equal((await other.handle(webhook(raw1, sign(raw1)), BILLING_ENV)).status, 200);
  const raw2 = JSON.stringify(subEvent({ uid: null }));
  assert.equal((await other.handle(webhook(raw2, sign(raw2)), BILLING_ENV)).status, 200);
  assert.equal(await billingDoc(other.db), null);
});

test('요금제 판정표 — 유료 상태 + Pro 가격만 pro, 그 밖은 enforced에 따라 free/beta', () => {
  const prices = { month: 'pri_month_test', year: 'pri_year_test' };
  for (const status of ['active', 'trialing', 'past_due']) {
    assert.equal(resolvePlan({ status, priceId: 'pri_year_test' }, { prices }), 'pro', status);
  }
  for (const doc of [null, { status: 'canceled', priceId: 'pri_month_test' }, { status: 'paused', priceId: 'pri_month_test' }, { status: 'active', priceId: 'pri_other' }]) {
    assert.equal(resolvePlan(doc, { prices, enforced: false }), 'beta', JSON.stringify(doc));
    assert.equal(resolvePlan(doc, { prices, enforced: true }), 'free', JSON.stringify(doc));
  }
});

function checkoutRequest(body, { auth = true } = {}) {
  return new globalThis.Request('https://worker.test/v1/billing/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: `chrome-extension://${TEST_ENV.EXTENSION_ID}`,
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function fakePaddle() {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return new globalThis.Response(JSON.stringify({ data: { id: 'txn_test', checkout: { url: 'https://site.test/checkout?_ptxn=txn_test' } } }), {
      status: 201,
    });
  };
  impl.seen = seen;
  return impl;
}

test('P3 — 결제 시작: 로그인 필수, 모르는 요금제 400, 거래에 uid·설정 가격 ID, 응답에 키 없음', async () => {
  const paddle = fakePaddle();
  const { handle, logger } = setup({ fetchImpl: paddle });
  assert.equal((await handle(checkoutRequest({ plan: 'pro', interval: 'month' }, { auth: false }), BILLING_ENV)).status, 401);
  assert.equal((await handle(checkoutRequest({ plan: 'team', interval: 'month' }), BILLING_ENV)).status, 400);
  assert.equal((await handle(checkoutRequest({ plan: 'pro', interval: 'week' }), BILLING_ENV)).status, 400);

  const res = await handle(checkoutRequest({ plan: 'pro', interval: 'year' }), BILLING_ENV);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { transactionId: 'txn_test', checkoutUrl: 'https://site.test/checkout?_ptxn=txn_test' });
  const sent = paddle.seen.at(-1);
  assert.equal(sent.url, 'https://sandbox-api.paddle.com/transactions');
  assert.equal(sent.auth, `Bearer ${API_KEY}`);
  assert.deepEqual(sent.body.items, [{ price_id: 'pri_year_test', quantity: 1 }]);
  assert.deepEqual(sent.body.custom_data, { uid: UID });
  assert.equal(JSON.stringify(body).includes(API_KEY), false);
  assert.equal(logger.lines.join('\n').includes(API_KEY), false);
});

test('P3 — 키·가격 설정이 없으면 503, Paddle 오류는 502(상태 코드만 로그)', async () => {
  const { handle } = setup({ fetchImpl: fakePaddle() });
  const res = await handle(checkoutRequest({ plan: 'pro', interval: 'month' }), { ...BILLING_ENV, PADDLE_API_KEY: undefined });
  assert.equal(res.status, 503);

  const failing = async () => new globalThis.Response('{"error":{"detail":"secret-ish"}}', { status: 403 });
  const broken = setup({ fetchImpl: failing });
  const res2 = await broken.handle(checkoutRequest({ plan: 'pro', interval: 'month' }), BILLING_ENV);
  assert.equal(res2.status, 502);
  assert.match(broken.logger.lines.join('\n'), /http-403/);
  assert.equal(broken.logger.lines.join('\n').includes('secret-ish'), false);
});

async function refineAs(handle, quality, env) {
  const res = await handle(refineRequest(token, { ...BASE_BODY, text: `${BASE_BODY.text} ${Math.random()}`, quality }), env);
  return { status: res.status, body: await res.json() };
}

test('P4·P5 — 요금제별 한도: beta(지금) 그대로 · free는 상위 모드 plan·하루 20 · pro는 기본 10', async () => {
  // beta — 구독 없음, BILLING_ENFORCED 꺼짐: 기본 모드가 그대로 열린다(지금과 같다).
  const beta = setup();
  assert.equal((await refineAs(beta.handle, 'standard', BILLING_ENV)).body.quality, 'standard');

  // free — 켜짐: 기본·심층은 빠른 + plan, 21번째는 429.
  const freeStore = createMemoryUsageStore();
  const free = setup({ usageStore: freeStore });
  const enforced = { ...BILLING_ENV, BILLING_ENFORCED: '1' };
  const first = await refineAs(free.handle, 'deep', enforced);
  assert.deepEqual([first.body.quality, first.body.qualityDowngrade], ['fast', 'plan']);
  for (let i = 1; i < 20; i += 1) await refineAs(free.handle, 'fast', enforced);
  assert.equal((await refineAs(free.handle, 'fast', enforced)).status, 429);

  // pro — 구독 있음(켜짐이어도): 기본 10번까지 기본, 11번째 빠른 + daily.
  const proStore = createMemoryUsageStore();
  proStore.setBilling(UID, { status: 'active', priceId: 'pri_month_test' });
  const pro = setup({ usageStore: proStore });
  for (let i = 0; i < 10; i += 1) assert.equal((await refineAs(pro.handle, 'standard', enforced)).body.quality, 'standard');
  const eleventh = await refineAs(pro.handle, 'standard', enforced);
  assert.deepEqual([eleventh.body.quality, eleventh.body.qualityDowngrade], ['fast', 'daily']);
  assert.ok(QUALITY_MODES.fast);
});

test('P6 — /health는 준비 여부만, 로그에 uid·서명·키 없음', async () => {
  const { handle, logger } = setup();
  const health = await (await handle(new globalThis.Request('https://worker.test/health'), BILLING_ENV)).json();
  assert.deepEqual(health.billing, { checkout: true, webhook: true, enforced: false });
  const noBilling = await (await handle(new globalThis.Request('https://worker.test/health'), TEST_ENV)).json();
  assert.equal(noBilling.billing, 'unavailable');

  const raw = JSON.stringify(subEvent());
  const signature = sign(raw);
  await handle(webhook(raw, signature), BILLING_ENV);
  await handle(webhook(raw, sign(raw, { secret: 'x' })), BILLING_ENV);
  const logs = logger.lines.join('\n');
  for (const banned of [UID, SECRET, signature.split('h1=')[1]]) assert.equal(logs.includes(banned), false, banned);
});

test('서명 검증 함수 — 대문자 hex도 받는다', async () => {
  const raw = '{"a":1}';
  const sig = sign(raw).replace(/h1=(.*)$/, (_, h) => `h1=${h.toUpperCase()}`);
  assert.equal(await verifyPaddleSignature(raw, sig, SECRET, NOW), true);
});

test('해지 예약(scheduled_change.action=cancel)을 기록한다 — 계정 삭제 허용 조건(functions/account.js)', async () => {
  const { handle, db } = setup();
  const event = subEvent({ type: 'subscription.updated', occurred: '2026-10-31T12:00:00Z' });
  event.data.scheduled_change = { action: 'cancel', effective_at: '2026-11-30T00:00:00Z' };
  const raw = JSON.stringify(event);
  assert.equal((await handle(webhook(raw, sign(raw)), BILLING_ENV)).status, 200);
  const doc = await billingDoc(db);
  assert.equal(doc.status, 'active');
  assert.equal(doc.cancelScheduled, true);

  const plain = setup();
  const raw2 = JSON.stringify(subEvent());
  await plain.handle(webhook(raw2, sign(raw2)), BILLING_ENV);
  assert.equal((await billingDoc(plain.db)).cancelScheduled, false);
});
