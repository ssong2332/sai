/**
 * 결제 시작 — Worker `/v1/billing/checkout` (2026-10-31, `docs/BillingDesign.md` ①).
 *
 * 🔴 확장은 가격 ID·키를 모른다 — 요금제 이름(`pro`)과 주기(`month`·`year`)만 보낸다. 가격 ID는 Worker 설정이 정한다.
 * 🔴 결제창은 확장이 아니라 새 탭의 그로블(`groble.im/payment/<상품>?ref=<토큰>`)에서 열린다(2026-11-04 Groble 전환).
 *    해지·취소 요청은 구매자가 그로블 주문조회에서 한다(그로블 결제창 연동 가이드, 2026-11-05 확인).
 * 🔴 `FEATURES.billing`이 꺼져 있으면 화면에 진입점이 없다(`src/config.js`).
 */

import { BILLING_CHECKOUT_ENDPOINT, BILLING_ME_ENDPOINT } from '../config.js';
import { getIdToken } from './authClient.js';
import { PLAN_LIMITS } from '../core/refine/quality.js';

export const BILLING_ERRORS = {
  NOT_SIGNED_IN: 'not-signed-in',
  NETWORK: 'network',
  UNAVAILABLE: 'billing-unavailable',
  NOT_OWNER: 'not-owner', // 팀 결제는 팀장만(2026-11-01)
  BAD_SEATS: 'bad-seats', // 좌석 2~100 · 지금 팀원 수 이상
  ALREADY_SUBSCRIBED: 'already-subscribed', // 2026-11-01 코드 검토 — 결제 중이면 두 번째 구독을 만들지 않는다
  UNKNOWN: 'unknown',
};

/**
 * 화면 가격·좌석(2026-11-04 사용자 결정 — Spec §0 · `docs/BillingDesign.md` 0-7). 🔴 실제 청구 금액은 그로블 상품이 정한다 —
 * 그로블 상품 가격을 바꾸면 여기도 같이 바꾼다. 좌석 범위는 Worker `GROBLE_PRODUCTS`(팀 2~10석)와 같다.
 */
export const PRICES_KRW = { proMonth: 7900, proYear: 59000, teamSeatMonth: 13900, teamSeatYear: 135000 };
export const TEAM_SEATS_MIN = 2;
export const TEAM_SEATS_MAX = 10;

/**
 * 팀 탭 구매 칸을 숨길지 — 서버 `liveSubscription`(결제 중 · 해지 예약 없음 → 409 `already-subscribed`)과 같은 판정(2026-11-05).
 * | 팀 구독 | 결과 |
 * |---|---|
 * | 없음 · 끝남(`canceled` 등) | 보임 |
 * | `active`·`trialing`·`past_due` + 해지 예약 | 보임 — 서버가 새 구매를 받는다 |
 * | `active`·`trialing`·`past_due` + 해지 예약 없음 | **숨김** — 좌석 변경은 해지 후 다시 구매 |
 */
export function teamPurchaseBlocked(billing) {
  return Boolean(billing) && ['active', 'trialing', 'past_due'].includes(billing.status) && billing.cancelScheduled !== true;
}

/** 원화 표기 — `₩7,900`. */
export function formatKrw(amount) {
  return `₩${Math.round(amount).toLocaleString('ko-KR')}`;
}

/** 해지·변경 안내 — 구매자는 그로블 계정 없이 휴대폰 인증으로 결제하고, 주문조회에서 관리한다. */
export const GROBLE_MANAGE_NOTE = '해지·취소 요청은 그로블 주문조회(groble.im)에서 할 수 있어요.';

/**
 * 환불 신청 · 구독 해지(2026-11-05 사용자 결정 「A안」).
 * | 버튼 | 언제 보이나 | 누르면 |
 * |---|---|---|
 * | 환불 신청 | 결제 중이면 늘(7일이 지나도) | 그로블 주문조회 새 탭 — 7일 안이면 취소 요청 → 이유를 묻지 않고 전액 환불(운영자가 그로블에서 처리) |
 * | 구독 해지 | 결제 중 · 해지 예약 전(월·연 모두 — 연간도 12개월마다 자동 결제) | 그로블 주문조회 새 탭 |
 * 🔴 7일이 지나면 환불하지 않는다 — 구독 해지로 안내한다(`dashboard/public/refund.html` 3절).
 * 🔴 확장은 결제일을 모른다 — 7일 판정은 그로블·운영자가 한다. 서버는 바꾸지 않는다.
 * 🔴 주소는 그로블 사이트의 「주문조회」 링크(`/account/purchases`, 2026-11-05 확인).
 */
export const GROBLE_ORDERS_URL = 'https://groble.im/account/purchases';
export const REFUND_NOTE =
  '결제일로부터 7일 안이면 그로블 주문조회에서 취소(환불)를 요청해 주세요. 이유를 묻지 않고 전액 환불해 드려요. 7일이 지나면 환불되지 않아요 — 대신 구독을 해지하면 다음 결제부터 멈춰요.';
export const CANCEL_NOTE = '해지해도 이미 결제한 기간이 끝날 때까지는 그대로 써요.';

/** 결제 중(환불·해지 버튼을 보일 상태)인가 — 팀 구독용. */
export function subscriptionManageable(billing) {
  return Boolean(billing) && ['active', 'trialing', 'past_due'].includes(billing.status);
}

export class BillingClientError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * @param {'month'|'year'} interval
 * @param {{plan?: 'pro'|'team', teamId?: string, seats?: number, fetchImpl?: Function}} [options] 팀이면 teamId·seats(2026-11-01)
 * @returns {Promise<string>} 결제 주소
 */
export async function startCheckout(interval, { plan = 'pro', teamId, seats, fetchImpl = globalThis.fetch } = {}) {
  if (interval !== 'month' && interval !== 'year') throw new BillingClientError(BILLING_ERRORS.UNKNOWN);
  if (plan !== 'pro' && plan !== 'team') throw new BillingClientError(BILLING_ERRORS.UNKNOWN);
  const token = await getIdToken({ fetchImpl });
  if (!token) throw new BillingClientError(BILLING_ERRORS.NOT_SIGNED_IN);
  let response;
  try {
    response = await fetchImpl(BILLING_CHECKOUT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(plan === 'team' ? { plan, interval, teamId, seats } : { plan, interval }),
    });
  } catch {
    throw new BillingClientError(BILLING_ERRORS.NETWORK);
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new BillingClientError(BILLING_ERRORS.NOT_SIGNED_IN);
  if (response.status === 503) throw new BillingClientError(BILLING_ERRORS.UNAVAILABLE);
  if (response.status === 403) throw new BillingClientError(BILLING_ERRORS.NOT_OWNER);
  if (response.status === 400 && payload?.error === 'bad seats') throw new BillingClientError(BILLING_ERRORS.BAD_SEATS);
  if (response.status === 409 && payload?.error === 'already-subscribed') throw new BillingClientError(BILLING_ERRORS.ALREADY_SUBSCRIBED);
  if (!response.ok || typeof payload?.checkoutUrl !== 'string') throw new BillingClientError(BILLING_ERRORS.UNKNOWN);
  return payload.checkoutUrl;
}

/**
 * 내 요금제 — 로고 옆 배지용(2026-11-01 사용자 결정 「로고 옆 배지로」). 판정은 Worker `resolvePlan`.
 * 🔴 배지는 장식이다 — 로그인 안 함·네트워크·서버 오류는 전부 `null`(배지 없음)로 조용히 끝낸다.
 * @returns {Promise<'pro'|'team'|'free'|'beta'|null>}
 */
export async function getMyPlan({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const token = await getIdToken({ fetchImpl });
    if (!token) return null;
    const response = await fetchImpl(BILLING_ME_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const plan = (await response.json().catch(() => ({})))?.plan;
    return ['pro', 'team', 'free', 'beta'].includes(plan) ? plan : null;
  } catch {
    return null;
  }
}

/** 배지 글자 — 결제한 요금제만. 그 밖은 `null`(배지 없음). */
export function planBadgeLabel(plan) {
  if (plan === 'team') return 'TEAM';
  if (plan === 'pro') return 'PRO';
  return null;
}

/**
 * 설정 「지금 플랜」 문구(2026-11-01 사용자 결정 「지금 수정하자」) — 결제한 사람에게 「무료 · 출시 기간」이 보이지 않게.
 * | 요금제 | 플랜 | 하루 횟수 |
 * |---|---|---|
 * | team | 팀 요금제 | 200회 · 기본 20 · 심층 5 |
 * | pro | Pro | 200회 · 기본 10 · 심층 3 |
 * | free | 무료 | 20회 · 빠른 모드만 |
 * | beta · 모름(`null`) | `null` — 화면이 지금 문구(출시 기간) 그대로 |
 * 숫자는 `PLAN_LIMITS`(Worker 판정과 같은 표)에서 읽는다.
 */
export function planSummary(plan) {
  const limits = PLAN_LIMITS[plan];
  if (!limits || plan === 'beta') return null;
  const modes = limits.standard + limits.deep > 0 ? ` · 기본 ${limits.standard} · 심층 ${limits.deep}` : ' · 빠른 모드만';
  const daily = `${limits.daily}회${modes}`;
  if (plan === 'team') return { name: '팀 요금제', daily, note: '팀장이 산 좌석으로 써요. 좌석은 팀 탭에서 팀장이 관리해요.' };
  if (plan === 'pro') return { name: 'Pro', daily, note: GROBLE_MANAGE_NOTE };
  return { name: '무료', daily, note: '다 쓰면 다음 날(한국 시간 자정) 다시 채워져요.' };
}

/** 화면 문구 — 사유 코드 → 한 줄. */
export function billingErrorText(reason) {
  if (reason === BILLING_ERRORS.NOT_SIGNED_IN) return '먼저 로그인해 주세요 — 결제는 로그인한 계정에 적용돼요.';
  if (reason === BILLING_ERRORS.NETWORK) return '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  if (reason === BILLING_ERRORS.UNAVAILABLE) return '지금은 결제를 받을 수 없어요. 잠시 뒤 다시 시도해 주세요.';
  if (reason === BILLING_ERRORS.NOT_OWNER) return '팀 요금제는 팀장만 구매할 수 있어요.';
  if (reason === BILLING_ERRORS.BAD_SEATS) return `좌석은 ${TEAM_SEATS_MIN}~${TEAM_SEATS_MAX}석, 지금 팀원 수 이상이어야 해요.`;
  if (reason === BILLING_ERRORS.ALREADY_SUBSCRIBED) return '이미 결제 중인 구독이 있어요 — 바꾸려면 그로블 주문조회(groble.im)에서 지금 구독을 먼저 해지해 주세요.';
  return '결제창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}
