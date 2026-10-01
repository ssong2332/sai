/**
 * 베타 지표 (L20, 2026-10-01) — `functions/betaMetrics.js`.
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 지표 문서에 **본문·uid가 들어갈 자리가 없다** — 고정 필드 이름 + 정수 증가뿐
 *    ② 표에 없는 모드·사유·이름은 임의 필드를 만들지 않는다
 *    ③ 재방문 판정 창(7일)보다 카운터 보존 기간이 길다 — 짧으면 재방문자를 신규로 센다
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  latencyBucket,
  requestFieldPaths,
  previousDateKeys,
  recordRequest,
  recordDailyUser,
  recordClientMetric,
  RETURNING_WINDOW_DAYS,
  CLIENT_METRIC_KINDS,
} from '../functions/betaMetrics.js';
import { QUOTA_RETENTION_DAYS } from '../functions/refineQuota.js';

/** set 호출과 getAll만 흉내 낸다. */
function fakeDb(existing = []) {
  const writes = [];
  const ref = (path) => ({
    path,
    get: async () => ({ exists: existing.includes(path) }),
    set: async (data, options) => writes.push({ path, data, merge: options?.merge === true }),
  });
  return {
    writes,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
  };
}

/** 쓰인 데이터에서 증가 그룹(`requests`·`outcome`·`latency`·`users`·`client`)의 `group.key` 경로만 뽑는다. */
const GROUPS = ['requests', 'outcome', 'latency', 'users', 'client'];
function incrementedPaths(data) {
  const out = [];
  for (const group of GROUPS) {
    for (const key of Object.keys(data[group] ?? {})) out.push(`${group}.${key}`);
  }
  return out.sort();
}

const req = (body, token = 'tok') => ({ body, get: () => (token ? 'Bearer ' + token : '') });
const NOW = new Date('2026-10-01T03:00:00Z'); // 서울 2026-10-01 12:00

/* ── 순수 판정 ─────────────────────────────────────────────────────── */

test('응답 시간 구간 — 경계값은 아래 구간에 들어간다', () => {
  assert.equal(latencyBucket(0), 'le1000');
  assert.equal(latencyBucket(1000), 'le1000');
  assert.equal(latencyBucket(1001), 'le2000');
  assert.equal(latencyBucket(4999), 'le5000');
  assert.equal(latencyBucket(10000), 'le10000');
  assert.equal(latencyBucket(10001), 'gt10000');
  assert.equal(latencyBucket(Number.NaN), 'le1000');
});

test('요청 결과 판정표 — 성공·폴백 사유·거절', () => {
  assert.deepEqual(requestFieldPaths({ mode: 'refine', latencyMs: 2500 }), [
    'requests.refine',
    'outcome.ok',
    'latency.le3000',
  ]);
  assert.deepEqual(
    requestFieldPaths({ mode: 'decode', fallback: true, fallbackReason: 'quota', latencyMs: 500 }),
    ['requests.decode', 'outcome.quota', 'latency.le1000'],
  );
  assert.deepEqual(requestFieldPaths({ mode: 'reply', rejected: true, latencyMs: 20000 }), [
    'requests.reply',
    'outcome.rejected',
    'latency.gt10000',
  ]);
});

test('🔴 표에 없는 모드·사유는 other로 모은다 — 임의 필드 이름을 만들지 않는다', () => {
  assert.deepEqual(
    requestFieldPaths({ mode: '<script>', fallback: true, fallbackReason: 'drop table', latencyMs: 1 }),
    ['requests.other', 'outcome.other', 'latency.le1000'],
  );
});

test('직전 날짜 계산 — 월 경계를 넘는다', () => {
  assert.deepEqual(previousDateKeys('2026-10-01', 3), ['2026-09-30', '2026-09-29', '2026-09-28']);
});

test('🔴 카운터 보존 기간이 재방문 판정 창보다 길다', () => {
  assert.ok(QUOTA_RETENTION_DAYS > RETURNING_WINDOW_DAYS, `${QUOTA_RETENTION_DAYS} <= ${RETURNING_WINDOW_DAYS}`);
});

/* ── 기록 ─────────────────────────────────────────────────────────── */

test('🔴 요청 기록 — 날짜 문서 하나에 합계만, 본문·uid 자리가 없다', async () => {
  const db = fakeDb();
  await recordRequest(db, { mode: 'refine', fallback: true, fallbackReason: 'error', latencyMs: 1200 }, NOW);
  assert.equal(db.writes.length, 1);
  const [write] = db.writes;
  assert.equal(write.path, 'betaMetrics/2026-10-01');
  assert.equal(write.merge, true);
  assert.deepEqual(incrementedPaths(write.data), ['latency.le2000', 'outcome.error', 'requests.refine']);
  assert.deepEqual(Object.keys(write.data).sort(), ['dateKey', 'latency', 'outcome', 'requests', 'updatedAt']);
});

test('재방문 — 직전 7일 안에 카운터가 있으면 returning도 센다', async () => {
  const db = fakeDb(['refineQuota/u1_2026-09-26']);
  const outcome = await recordDailyUser(db, 'u1', NOW);
  assert.equal(outcome.returning, true);
  assert.deepEqual(incrementedPaths(db.writes[0].data), ['users.active', 'users.returning']);
});

test('신규 — 7일보다 오래된 기록은 재방문이 아니다', async () => {
  const db = fakeDb(['refineQuota/u1_2026-09-23']); // 8일 전
  const outcome = await recordDailyUser(db, 'u1', NOW);
  assert.equal(outcome.returning, false);
  assert.deepEqual(incrementedPaths(db.writes[0].data), ['users.active']);
});

test('🔴 재방문 기록에 uid가 남지 않는다', async () => {
  const db = fakeDb(['refineQuota/secret-uid_2026-09-30']);
  await recordDailyUser(db, 'secret-uid', NOW);
  assert.equal(JSON.stringify(db.writes).includes('secret-uid'), false);
});

/* ── 확장 → teamV1 metric ──────────────────────────────────────────── */

const metricDeps = (db) => ({ db: () => db, verifyIdToken: async () => ({ uid: 'u1' }), now: () => NOW });

test('확장 지표 — 표에 있는 이름만 받는다', async () => {
  assert.deepEqual(CLIENT_METRIC_KINDS, ['applied', 'undone']);
  const db = fakeDb();
  await recordClientMetric(req({ kind: 'undone' }), metricDeps(db));
  assert.deepEqual(incrementedPaths(db.writes[0].data), ['client.undone']);
});

test('🔴 표에 없는 이름은 400 — 아무것도 쓰지 않는다', async () => {
  const db = fakeDb();
  await assert.rejects(
    () => recordClientMetric(req({ kind: 'message-text' }), metricDeps(db)),
    (e) => e.status === 400 && e.reason === 'unknown-metric',
  );
  assert.equal(db.writes.length, 0);
});

test('🔴 로그인하지 않으면 401', async () => {
  await assert.rejects(
    () => recordClientMetric(req({ kind: 'applied' }, ''), metricDeps(fakeDb())),
    (e) => e.status === 401,
  );
});
