/**
 * 베타 지표 — 날짜별 합계 (L20, 2026-10-01).
 *
 * 🔴 **판정표 (2026-10-01)** — 저장은 `betaMetrics/{서울 날짜}` 한 문서에 **합계만** 한다.
 *
 * | 지표 | 어디서 세나 | 필드 |
 * |---|---|---|
 * | 요청 수(모드별) | `refineV1` 응답 직전 | `requests.{refine·decode·decisions·reply}` |
 * | 결과 | 같은 곳 | `outcome.ok` · `outcome.{quota·error·invalid}` · `outcome.rejected`(400) |
 * | 응답 시간 | 같은 곳 — 요청 수신~응답 | `latency.{le1000·le2000·le3000·le5000·le10000·gt10000}` |
 * | 일일 사용자 · 재방문 | 그날 첫 요청(`refineQuota` 카운트가 1) | `users.active` · `users.returning`(직전 7일에 사용 기록) |
 * | 적용 · 되돌리기 | 확장 → `teamV1` `metric` 동작 | `client.applied` · `client.undone` |
 *
 * 🔴 **Zero Retention (Spec 필수 5)**: 본문·uid·이메일은 이 문서에 **들어갈 자리가 없다** — 필드 이름이
 *    고정 집합이고 값은 정수 증가뿐이다. 재방문 판정에 uid를 쓰지만 **판정에만** 쓰고 저장하지 않는다
 *    (읽는 것은 이미 있는 `refineQuota/{uid}_{날짜}` 카운터다).
 * 🔴 **지표 기록이 교정을 막지 않는다** — 호출부(`index.js`)가 실패를 삼키고 로그만 남긴다.
 * 🔴 판정은 순수 함수(`requestFieldPaths`·`latencyBucket`·`previousDateKeys`)이고 Firestore는 얇게 감싼다.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { TeamError, requireUid } from './teams.js';
import { seoulDateKey } from './refineQuota.js';

const COLLECTION = 'betaMetrics';
const MODES = ['refine', 'decode', 'decisions', 'reply'];
const FALLBACK_REASONS = ['quota', 'error', 'invalid'];
/** 응답 시간 구간 상한(ms). p95는 구간 누적으로 근사한다 — 원시 값을 남기지 않는다. */
export const LATENCY_BUCKETS_MS = [1000, 2000, 3000, 5000, 10000];
/** 재방문 판정 창 — 「주간 재사용」(Tasks L20). `refineQuota` 보존 기간(QUOTA_RETENTION_DAYS)이 이보다 길어야 한다. */
export const RETURNING_WINDOW_DAYS = 7;
/** 확장이 보낼 수 있는 이름. 🔴 표에 없는 이름은 거절한다 — 임의 필드가 생기는 길을 막는다. */
export const CLIENT_METRIC_KINDS = ['applied', 'undone'];

export function latencyBucket(ms) {
  const value = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  const bound = LATENCY_BUCKETS_MS.find((limit) => value <= limit);
  return bound ? `le${bound}` : `gt${LATENCY_BUCKETS_MS.at(-1)}`;
}

/**
 * 요청 하나가 올릴 필드 경로. 표에 없는 모드·사유는 `other`로 모은다(임의 이름을 만들지 않는다).
 * @param {{mode: string, rejected?: boolean, fallback?: boolean, fallbackReason?: string, latencyMs: number}} input
 */
export function requestFieldPaths({ mode, rejected = false, fallback = false, fallbackReason, latencyMs }) {
  const modeKey = MODES.includes(mode) ? mode : 'other';
  let outcome = 'ok';
  if (rejected) outcome = 'rejected';
  else if (fallback) outcome = FALLBACK_REASONS.includes(fallbackReason) ? fallbackReason : 'other';
  return [`requests.${modeKey}`, `outcome.${outcome}`, `latency.${latencyBucket(latencyMs)}`];
}

/** `2026-10-01`의 직전 n일(서울) — 최근 것부터. */
export function previousDateKeys(dateKey, days) {
  const start = new Date(`${dateKey}T12:00:00+09:00`).getTime(); // 정오 — 자정 경계 오차를 피한다
  return Array.from({ length: days }, (_, i) => seoulDateKey(new Date(start - (i + 1) * 86_400_000)));
}

/** `['a.b', 'a.c']` → `{a: {b: inc, c: inc}}` — merge set이 중첩 맵을 합치게 한다. */
function toIncrements(paths) {
  const out = {};
  for (const path of paths) {
    const [group, key] = path.split('.');
    out[group] = { ...(out[group] ?? {}), [key]: FieldValue.increment(1) };
  }
  return out;
}

async function bump(db, dateKey, paths) {
  await db
    .collection(COLLECTION)
    .doc(dateKey)
    .set({ dateKey, ...toIncrements(paths), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** `refineV1` 응답 직전에 부른다. */
export async function recordRequest(db, input, now = new Date()) {
  await bump(db, seoulDateKey(now), requestFieldPaths(input));
}

/**
 * 그날 첫 요청일 때만 부른다(`consumeDailyQuota`가 `used: 1`을 준 경우).
 * 🔴 uid는 직전 카운터 문서를 **찾는 데만** 쓰고 지표 문서에는 남기지 않는다.
 * @returns {Promise<{returning: boolean}>}
 */
export async function recordDailyUser(db, uid, now = new Date()) {
  const dateKey = seoulDateKey(now);
  const refs = previousDateKeys(dateKey, RETURNING_WINDOW_DAYS).map((key) =>
    db.collection('refineQuota').doc(`${uid}_${key}`),
  );
  const snaps = await db.getAll(...refs);
  const returning = snaps.some((snap) => snap.exists);
  await bump(db, dateKey, returning ? ['users.active', 'users.returning'] : ['users.active']);
  return { returning };
}

/** `teamV1` `action: "metric"` — 확장이 적용·되돌리기를 센다. 🔴 로그인한 사용자만, 표에 있는 이름만. */
export async function recordClientMetric(req, deps) {
  await requireUid(req, deps);
  const kind = String(req.body?.kind ?? '');
  if (!CLIENT_METRIC_KINDS.includes(kind)) throw new TeamError(400, 'unknown-metric');
  await bump(deps.db(), seoulDateKey(deps.now?.() ?? new Date()), [`client.${kind}`]);
  return { ok: true };
}
