/**
 * 결제 시작 — Worker `/v1/billing/checkout` (2026-10-31, `docs/BillingDesign.md` ①).
 *
 * 🔴 확장은 가격 ID·키를 모른다 — 요금제 이름(`pro`)과 주기(`month`·`year`)만 보낸다. 가격 ID는 Worker 설정이 정한다.
 * 🔴 결제창은 확장이 아니라 소개 사이트(`/checkout`)에서 열린다 — MV3는 원격 스크립트(Paddle.js)를 못 싣는다.
 * 🔴 `FEATURES.billing`이 꺼져 있으면 화면에 진입점이 없다(`src/config.js`).
 */

import { BILLING_CHECKOUT_ENDPOINT, BILLING_ME_ENDPOINT } from '../config.js';
import { getIdToken } from './authClient.js';

export const BILLING_ERRORS = {
  NOT_SIGNED_IN: 'not-signed-in',
  NETWORK: 'network',
  UNAVAILABLE: 'billing-unavailable',
  NOT_OWNER: 'not-owner', // 팀 결제는 팀장만(2026-11-01)
  BAD_SEATS: 'bad-seats', // 좌석 2~100 · 지금 팀원 수 이상
  ALREADY_SUBSCRIBED: 'already-subscribed', // 2026-11-01 코드 검토 — 결제 중이면 두 번째 구독을 만들지 않는다
  UNKNOWN: 'unknown',
};

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

/** 화면 문구 — 사유 코드 → 한 줄. */
export function billingErrorText(reason) {
  if (reason === BILLING_ERRORS.NOT_SIGNED_IN) return '먼저 로그인해 주세요 — 결제는 로그인한 계정에 적용돼요.';
  if (reason === BILLING_ERRORS.NETWORK) return '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  if (reason === BILLING_ERRORS.UNAVAILABLE) return '지금은 결제를 받을 수 없어요. 잠시 뒤 다시 시도해 주세요.';
  if (reason === BILLING_ERRORS.NOT_OWNER) return '팀 요금제는 팀장만 구매할 수 있어요.';
  if (reason === BILLING_ERRORS.BAD_SEATS) return '좌석은 2석 이상, 지금 팀원 수 이상이어야 해요.';
  if (reason === BILLING_ERRORS.ALREADY_SUBSCRIBED) return '이미 결제 중인 구독이 있어요 — 바꾸려면 영수증 메일의 Paddle 링크(paddle.net)에서 관리해 주세요.';
  return '결제창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}
