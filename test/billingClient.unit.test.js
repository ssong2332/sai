/**
 * 결제 시작 클라이언트 (2026-10-31, `src/lib/billingClient.js`) — 요금제 이름·주기만 보내고, 사유 코드를 화면 문구로.
 * 🔴 네트워크 없음: fetch는 가짜. 로그인 토큰은 authClient를 흉내 낸 저장값으로.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { FEATURES } from '../src/config.js';
import {
  BILLING_ERRORS,
  billingErrorText,
  formatKrw,
  GROBLE_MANAGE_NOTE,
  getMyPlan,
  planBadgeLabel,
  planSummary,
  PRICES_KRW,
  startCheckout,
  TEAM_SEATS_MAX,
  TEAM_SEATS_MIN,
  teamPurchaseBlocked,
  subscriptionManageable,
  GROBLE_ORDERS_URL,
  REFUND_NOTE,
  CANCEL_NOTE,
} from '../src/lib/billingClient.js';
import { teamErrorMessage, TEAM_ERRORS } from '../src/lib/teamClient.js';
import { QUALITY_DOWNGRADE_NOTES } from '../src/core/refine/quality.js';

test('🔴 결제 진입점은 켜져 있다 — 2026-11-05 Groble 실판매 전환(사용자 결정 「진행」)', () => {
  assert.equal(FEATURES.billing, true);
});

test('🔴 화면 문구에 옛 Paddle·달러 안내가 남지 않는다 — 해지는 그로블 주문조회', () => {
  const texts = [
    ...Object.values(BILLING_ERRORS).map(billingErrorText),
    planSummary('pro').note,
    GROBLE_MANAGE_NOTE,
    teamErrorMessage(TEAM_ERRORS.SUBSCRIPTION_ACTIVE),
    teamErrorMessage(TEAM_ERRORS.TEAM_SUBSCRIPTION_ACTIVE),
  ];
  for (const t of texts) assert.doesNotMatch(t, /paddle|\$\d/i, t);
  assert.match(planSummary('pro').note, /그로블 주문조회/);
  for (const file of ['src/settings/App.jsx', 'src/sidepanel/App.jsx']) {
    assert.doesNotMatch(readFileSync(file, 'utf8').replace(/: '개인 Pro\(연 결제 시 월 \$4 · 월 결제 \$6 예정\)[^']*'/, ''), /\$\d/, file);
  }
});

test('🔴 화면 가격·좌석 = 결정값(Spec §0) · 좌석 범위 = Worker GROBLE_PRODUCTS 팀 상품', () => {
  assert.deepEqual(PRICES_KRW, { proMonth: 7900, proYear: 59000, teamSeatMonth: 13900, teamSeatYear: 135000 });
  assert.equal(formatKrw(PRICES_KRW.proYear / 12), '₩4,917');
  assert.equal(formatKrw(PRICES_KRW.teamSeatYear * 10), '₩1,350,000');
  const toml = readFileSync('workers/refine/wrangler.toml', 'utf8');
  const products = Object.values(JSON.parse(toml.match(/^GROBLE_PRODUCTS = '(.*)'$/m)[1]));
  for (const interval of ['month', 'year']) {
    const seats = products.filter((p) => p.plan === 'team' && p.interval === interval).map((p) => p.seats).sort((a, b) => a - b);
    assert.deepEqual(seats, Array.from({ length: TEAM_SEATS_MAX - TEAM_SEATS_MIN + 1 }, (_, i) => TEAM_SEATS_MIN + i), interval);
  }
});

test('팀 탭 구매 칸 — 결제 중(해지 예약 없음)이면 숨김, 서버 409 판정과 같다', () => {
  for (const status of ['active', 'trialing', 'past_due']) {
    assert.equal(teamPurchaseBlocked({ status, seats: 2, used: 1 }), true, status);
    assert.equal(teamPurchaseBlocked({ status, cancelScheduled: true }), false, `${status} 해지 예약`);
  }
  for (const billing of [null, undefined, { status: 'canceled' }, { status: '' }]) {
    assert.equal(teamPurchaseBlocked(billing), false, JSON.stringify(billing));
  }
});

test('환불·해지(2026-11-05) — 결제 중이면 해지 예약 뒤에도 환불 신청은 보인다 · 주문조회로 · 7일 뒤 환불 없음', () => {
  for (const status of ['active', 'trialing', 'past_due']) {
    assert.equal(subscriptionManageable({ status }), true, status);
    assert.equal(subscriptionManageable({ status, cancelScheduled: true }), true, `${status} 해지 예약`);
  }
  for (const billing of [null, undefined, { status: 'canceled' }, { status: '' }]) {
    assert.equal(subscriptionManageable(billing), false, JSON.stringify(billing));
  }
  assert.equal(GROBLE_ORDERS_URL, 'https://groble.im/account/purchases');
  assert.match(REFUND_NOTE, /7일 안/);
  assert.match(REFUND_NOTE, /이유를 묻지 않고 전액 환불/); // 환불 정책 2절과 같은 약속(2026-11-05 사용자 결정)
  assert.doesNotMatch(REFUND_NOTE, /승인/);
  assert.match(REFUND_NOTE, /7일이 지나면 환불되지 않아요/);
  assert.match(CANCEL_NOTE, /결제한 기간이 끝날 때까지/);
});

test('모르는 주기는 서버를 부르지 않고 거절', async () => {
  let called = false;
  await assert.rejects(
    () => startCheckout('week', { fetchImpl: async () => { called = true; return new globalThis.Response('{}'); } }),
    (e) => e.reason === BILLING_ERRORS.UNKNOWN,
  );
  assert.equal(called, false);
});

test('사유 코드마다 화면 문구가 있다 · 무료 요금제 낮춤 문구', () => {
  for (const reason of Object.values(BILLING_ERRORS)) assert.ok(billingErrorText(reason).length > 0, reason);
  assert.match(QUALITY_DOWNGRADE_NOTES.plan, /무료 요금제/);
});

test('로고 옆 배지 — 결제한 요금제(pro·team)만 글자, 그 밖은 배지 없음', () => {
  assert.equal(planBadgeLabel('pro'), 'PRO');
  assert.equal(planBadgeLabel('team'), 'TEAM');
  for (const plan of ['free', 'beta', null, undefined, 'x']) assert.equal(planBadgeLabel(plan), null, String(plan));
});

test('내 요금제 — 로그인 안 했으면 서버를 부르지 않고 null(배지 없음)', async () => {
  let called = false;
  const plan = await getMyPlan({ fetchImpl: async () => { called = true; return new globalThis.Response('{"plan":"pro"}'); } });
  assert.equal(plan, null);
  assert.equal(called, false);
});

test('설정 「지금 플랜」 — 결제한 요금제는 그 이름·한도(PLAN_LIMITS), 베타·모름은 null(출시 기간 문구 그대로)', () => {
  assert.deepEqual([planSummary('team').name, planSummary('team').daily], ['팀 요금제', '200회 · 기본 20 · 심층 5']);
  assert.deepEqual([planSummary('pro').name, planSummary('pro').daily], ['Pro', '200회 · 기본 10 · 심층 3']);
  assert.deepEqual([planSummary('free').name, planSummary('free').daily], ['무료', '20회 · 빠른 모드만']);
  for (const plan of ['beta', null, undefined, 'x']) assert.equal(planSummary(plan), null, String(plan));
});

// ── 2026-11-07 점검 — 결제 URL 허용 목록 ─────────────────────────────
// 🔴 서버 응답이 오염돼도 확장이 엉뚱한 사이트를 결제 창으로 열지 않는다.
import { isAllowedCheckoutUrl } from '../src/lib/billingClient.js';

test('🔴 결제 URL — 그로블(https)과 우리 사이트 /checkout만 연다', () => {
  assert.equal(isAllowedCheckoutUrl('https://groble.im/payment/abc?ref=t1'), true);
  assert.equal(isAllowedCheckoutUrl('https://www.groble.im/payment/abc'), true);
  assert.equal(isAllowedCheckoutUrl('https://sai-global-msg-2026.web.app/checkout?x=1'), true);
});

test('🔴 결제 URL — http·다른 호스트·비슷한 이름·다른 경로·깨진 값은 거절', () => {
  for (const bad of [
    'http://groble.im/payment/abc',
    'https://groble.im.evil.example/payment',
    'https://evilgroble.im/payment',
    'https://sai-global-msg-2026.web.app/settings',
    'javascript:alert(1)',
    'not a url',
    '',
    null,
  ]) {
    assert.equal(isAllowedCheckoutUrl(bad), false, bad);
  }
});
