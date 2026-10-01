/**
 * 베타 지표 — 확장 쪽 (L20, 2026-10-01). 적용·되돌리기 **횟수**만 서버 합계에 더한다.
 *
 * 🔴 **본문을 보내지 않는다.** 보내는 것은 `kind` 하나(고정 집합)뿐이다 — 서버도 표에 없는 이름은
 *    거절한다(`functions/betaMetrics.js` `CLIENT_METRIC_KINDS`).
 * 🔴 **콘텐츠 스크립트는 직접 부르지 않는다.** 페이지 오리진으로 나가서 `teamV1`의 CORS(확장 오리진만)에
 *    막힌다. 콘텐츠 → `chrome.runtime.sendMessage(METRIC_MESSAGE)` → 백그라운드가 `sendClientMetric`.
 * 🔴 **실패는 조용히 넘긴다** — 지표 때문에 적용·되돌리기가 늦어지거나 오류가 뜨면 안 된다.
 */
import { TEAM_ENDPOINT } from '../config.js';
import { getIdToken } from './authClient.js';

export const METRIC_MESSAGE = 'sai:metric';
export const METRIC_KINDS = { APPLIED: 'applied', UNDONE: 'undone' };

/** 백그라운드에서 부른다. @returns {Promise<{sent: boolean}>} */
export async function sendClientMetric(kind, { fetchImpl = globalThis.fetch } = {}) {
  if (!Object.values(METRIC_KINDS).includes(kind)) return { sent: false };
  try {
    const token = await getIdToken({ fetchImpl });
    if (!token) return { sent: false }; // 로그인 전 — 서버가 어차피 401이다.
    const response = await fetchImpl(TEAM_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'metric', kind }),
    });
    return { sent: response.ok };
  } catch {
    return { sent: false };
  }
}

/** 콘텐츠 스크립트에서 부른다 — 기다리지 않는다. */
export function reportMetric(kind) {
  try {
    chrome.runtime.sendMessage({ type: METRIC_MESSAGE, kind }).catch(() => {});
  } catch {
    // 확장이 다시 로드된 직후 등 — 지표는 버린다.
  }
}
