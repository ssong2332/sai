/**
 * 결제 시작 — Worker `/v1/billing/checkout` (2026-10-31, `docs/BillingDesign.md` ①).
 *
 * 🔴 확장은 가격 ID·키를 모른다 — 요금제 이름(`pro`)과 주기(`month`·`year`)만 보낸다. 가격 ID는 Worker 설정이 정한다.
 * 🔴 결제창은 확장이 아니라 소개 사이트(`/checkout`)에서 열린다 — MV3는 원격 스크립트(Paddle.js)를 못 싣는다.
 * 🔴 `FEATURES.billing`이 꺼져 있으면 화면에 진입점이 없다(`src/config.js`).
 */

import { BILLING_CHECKOUT_ENDPOINT } from '../config.js';
import { getIdToken } from './authClient.js';

export const BILLING_ERRORS = {
  NOT_SIGNED_IN: 'not-signed-in',
  NETWORK: 'network',
  UNAVAILABLE: 'billing-unavailable',
  UNKNOWN: 'unknown',
};

export class BillingClientError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/** @returns {Promise<string>} 결제 주소 */
export async function startCheckout(interval, { fetchImpl = globalThis.fetch } = {}) {
  if (interval !== 'month' && interval !== 'year') throw new BillingClientError(BILLING_ERRORS.UNKNOWN);
  const token = await getIdToken({ fetchImpl });
  if (!token) throw new BillingClientError(BILLING_ERRORS.NOT_SIGNED_IN);
  let response;
  try {
    response = await fetchImpl(BILLING_CHECKOUT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro', interval }),
    });
  } catch {
    throw new BillingClientError(BILLING_ERRORS.NETWORK);
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new BillingClientError(BILLING_ERRORS.NOT_SIGNED_IN);
  if (response.status === 503) throw new BillingClientError(BILLING_ERRORS.UNAVAILABLE);
  if (!response.ok || typeof payload?.checkoutUrl !== 'string') throw new BillingClientError(BILLING_ERRORS.UNKNOWN);
  return payload.checkoutUrl;
}

/** 화면 문구 — 사유 코드 → 한 줄. */
export function billingErrorText(reason) {
  if (reason === BILLING_ERRORS.NOT_SIGNED_IN) return '먼저 로그인해 주세요 — 결제는 로그인한 계정에 적용돼요.';
  if (reason === BILLING_ERRORS.NETWORK) return '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  if (reason === BILLING_ERRORS.UNAVAILABLE) return '지금은 결제를 받을 수 없어요. 잠시 뒤 다시 시도해 주세요.';
  return '결제창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}
