/**
 * 확장 안 팀 대시보드 주소 (2026-10-25, 0.1.21 — `src/dashboard/`).
 *
 * 🔴 주소에는 **팀 id 하나만** 싣는다(처음 고를 팀). 지표·팀 이름·날짜별 합계는 싣지 않는다 — 페이지가 확장의
 *    로그인으로 직접 읽는다. 예전 `#sai=<팀 합계 base64>`는 없앴다(URL·방문 기록에 팀 지표가 남았다).
 * 🔴 `chrome-extension://` 주소라 서버로 나가지 않는다. 팀 id는 지표가 아니다(그 자체로는 아무것도 읽을 수 없다 —
 *    `firestore.rules`가 팀원만 읽게 한다).
 */

export const DASHBOARD_PAGE = 'src/dashboard/index.html';

/** @param {(path: string) => string} getURL 보통 `chrome.runtime.getURL`. */
export function dashboardPageUrl(teamId, getURL = (path) => globalThis.chrome?.runtime?.getURL?.(path) ?? path) {
  const base = getURL(DASHBOARD_PAGE);
  return typeof teamId === 'string' && teamId !== '' ? `${base}?team=${encodeURIComponent(teamId)}` : base;
}
