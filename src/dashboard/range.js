/**
 * 확장 대시보드 — 「며칠치를 더 읽어야 하나」 계산 (2026-10-25, 0.1.21). **순수 함수만.**
 *
 * 🔴 판정표 (바꾸면 `test/dashboardRange.unit.test.js`를 같이 바꾼다)
 * | 상황 | 필요한 날 수 |
 * |---|---|
 * | 처음 열 때 (고른 팀) | `INITIAL_DAYS` = 30 |
 * | 기간 P, 비교 끔 | P |
 * | 기간 P, 비교 켬 | 2P (14→28 · 30→60 · 60→120) |
 * | 「맡은 관계 나란히」의 다른 팀 | `OTHER_TEAM_DAYS` = 30 (그 칸이 화면에 들어올 때만) |
 * | 이미 읽은 날 | 다시 읽지 않는다 — 빠진 날짜 키만 고른다 |
 * 🔴 날짜 키는 로컬 날짜(`friction.js`·`model.js dateKey`와 같은 규칙)다.
 */

export const INITIAL_DAYS = 30;
export const OTHER_TEAM_DAYS = 30;
/** 한 번에 읽을 수 있는 최대 날 수 — 60일 + 앞 60일. */
export const MAX_DAYS = 120;

const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 기간과 비교 여부로 필요한 날 수. 형식 밖이면 `INITIAL_DAYS`, 위로는 `MAX_DAYS`에서 자른다. */
export function daysNeeded(period, compare) {
  const p = Number.isInteger(period) && period > 0 ? period : INITIAL_DAYS;
  return Math.min(MAX_DAYS, compare ? p * 2 : p);
}

/** 오늘부터 거꾸로 `days`일의 날짜 키 — **오래된 날 → 오늘** 순서. */
export function recentKeys(days, today = new Date()) {
  const out = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    out.push(keyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)));
  }
  return out;
}

/**
 * 최근 `days`일 중 **아직 읽지 않은** 날짜 키(오래된 날 → 최근). 다 읽었으면 빈 배열.
 * @param {Set<string>|string[]} loaded 이미 읽은 날짜 키 — 문서가 없던 날도 「읽었음」이다.
 */
export function missingKeys(loaded, days, today = new Date()) {
  const have = loaded instanceof Set ? loaded : new Set(loaded ?? []);
  return recentKeys(days, today).filter((k) => !have.has(k));
}

/** 오늘부터 끊기지 않고 읽은 날 수 — 화면은 이 범위 안에서만 그린다(빠진 날을 0으로 지어내지 않는다). */
export function coveredDays(loaded, today = new Date(), max = MAX_DAYS) {
  const have = loaded instanceof Set ? loaded : new Set(loaded ?? []);
  let n = 0;
  while (n < max && have.has(keyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n)))) n += 1;
  return n;
}
