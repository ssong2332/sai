/**
 * Worker 주간 점검(M2, 2026-10-27 사용자 결정) — 판정만 하는 순수 함수. 네트워크·키는 `report.mjs`가 맡는다.
 *
 * 🔴 읽는 것은 `betaMetrics/{서울 날짜}` 합계 문서뿐이다(`functions/betaMetrics.js` 판정표) — 본문·uid·이메일이
 *    들어갈 자리가 없는 문서다(Spec 필수 5). 출력도 숫자와 사유 코드뿐이다.
 *
 * 경고 판정표 (2026-10-27 — 기준값은 실사용자가 생기면 다시 본다)
 * | 조건 | 경고 |
 * |---|---|
 * | 그날 요청 0건 | 없음 — 「요청 없음」으로만 표시 |
 * | 실패(quota·error·invalid·auth·other) ÷ 요청 ≥ 5%, 요청 20건 이상일 때만 | ⚠ 실패율 |
 * | `auth` 1건 이상 (키 무효 — 모든 단계가 키 문제) | ⚠ 키 무효 |
 * | `quota` 1건 이상 (폴오버 사슬 끝까지 한도) | ⚠ 한도 |
 * | 10초 넘은 응답 ÷ 요청 ≥ 10%, 요청 20건 이상일 때만 | ⚠ 느림 |
 * | `/health`가 200이 아님 · `configured` 아님 · `usageStore`≠`firestore` · `team`≠`ready` | ⚠ 서버 상태 |
 * 🔴 `rejected`(400 — 형식이 틀린 요청)는 실패율에 넣지 않는다. 서버 고장이 아니라 요청 쪽 문제다.
 */

export const MIN_REQUESTS_FOR_RATE = 20;
export const FAILURE_RATE_LIMIT = 0.05;
export const SLOW_RATE_LIMIT = 0.1;
const FAILURE_KEYS = ['quota', 'error', 'invalid', 'auth', 'other'];

const sum = (obj) => Object.values(obj ?? {}).reduce((acc, v) => acc + (Number(v) || 0), 0);
const num = (v) => Number(v) || 0;

/** `betaMetrics` 문서 하나(없으면 null) → 그날 요약. */
export function summarizeDay(dateKey, doc) {
  const requests = sum(doc?.requests);
  const outcome = doc?.outcome ?? {};
  const failures = FAILURE_KEYS.reduce((acc, key) => acc + num(outcome[key]), 0);
  const latency = doc?.latency ?? {};
  return {
    dateKey,
    requests,
    ok: num(outcome.ok),
    failures,
    quota: num(outcome.quota),
    auth: num(outcome.auth),
    rejected: num(outcome.rejected),
    within2s: num(latency.le1000) + num(latency.le2000),
    over10s: num(latency.gt10000),
    active: num(doc?.users?.active),
    returning: num(doc?.users?.returning),
    applied: num(doc?.client?.applied),
    undone: num(doc?.client?.undone),
  };
}

/** 하루 요약 → 경고 목록(판정표). */
export function judgeDay(day) {
  const warnings = [];
  if (day.requests === 0) return warnings;
  if (day.requests >= MIN_REQUESTS_FOR_RATE && day.failures / day.requests >= FAILURE_RATE_LIMIT) {
    warnings.push(`실패율 ${pct(day.failures, day.requests)}`);
  }
  if (day.auth > 0) warnings.push(`키 무효 ${day.auth}건`);
  if (day.quota > 0) warnings.push(`한도 ${day.quota}건`);
  if (day.requests >= MIN_REQUESTS_FOR_RATE && day.over10s / day.requests >= SLOW_RATE_LIMIT) {
    warnings.push(`10초 초과 ${pct(day.over10s, day.requests)}`);
  }
  return warnings;
}

/** `/health` 응답(상태 코드 + JSON 또는 null) → 경고 목록. */
export function judgeHealth(status, body) {
  if (status !== 200 || !body) return [`/health 응답 ${status}`];
  const warnings = [];
  if (body.configured !== true) warnings.push('provider 설정 누락');
  if (body.usageStore !== 'firestore') warnings.push(`usageStore=${body.usageStore}`);
  if (body.team !== 'ready') warnings.push(`team=${body.team}`);
  return warnings;
}

export function pct(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '-';
}
