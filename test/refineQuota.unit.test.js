/**
 * 일일 교정 상한 (`functions/refineQuota.js`) — 2026-08-17 신설.
 *
 * 🔴 **이 상한은 비용 방어선이다.** `refineV1`에 인증이 붙었지만 인증만으로는 돈이 막히지
 *    않는다 — 로그인한 한 명이 스크립트로 수천 건을 태울 수 있고, provider가 OpenAI(유료)로
 *    바뀐 뒤에는 그게 곧 청구서다. "대충 맞는" 카운트는 방어선이 아니므로 경계값을 못 박는다.
 * 🔴 **Zero Retention 검사가 여기 있다.** 메시지 본문이 들어갈 자리가 생기지 않았는지 필드
 *    화이트리스트로 확인한다 (Spec 필수 5).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeDailyQuota,
  seoulDateKey,
  DAILY_REFINE_LIMIT,
} from '../functions/refineQuota.js';

/** Firestore 트랜잭션 대역. 실제 규칙·네트워크 없이 읽기-쓰기 순서만 재현한다. */
function fakeDb(seed = {}) {
  const store = { ...seed };
  return {
    store,
    writes: [],
    collection(name) {
      return { doc: (id) => ({ __path: `${name}/${id}` }) };
    },
    async runTransaction(fn) {
      return fn({
        get: async (ref) => ({
          exists: Object.hasOwn(store, ref.__path),
          data: () => store[ref.__path],
        }),
        set: (ref, value, options) => {
          store[ref.__path] = options?.merge ? { ...store[ref.__path], ...value } : value;
        },
      });
    },
  };
}

test('첫 호출은 통과하고 1로 센다', async () => {
  const db = fakeDb();
  const r = await consumeDailyQuota(db, { uid: 'u1', now: new Date('2026-08-17T01:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(r.used, 1);
  assert.equal(db.store['refineQuota/u1_2026-08-17'].count, 1);
});

test('🔴 상한에 도달하면 거절하고 **더 세지 않는다**', async () => {
  // 세어 버리면 다음 날까지 상한이 어긋난다. 거절은 카운트를 건드리지 않아야 한다.
  const db = fakeDb({ 'refineQuota/u1_2026-08-17': { count: DAILY_REFINE_LIMIT } });
  const r = await consumeDailyQuota(db, { uid: 'u1', now: new Date('2026-08-17T01:00:00Z') });
  assert.equal(r.ok, false);
  assert.equal(db.store['refineQuota/u1_2026-08-17'].count, DAILY_REFINE_LIMIT);
});

test('🔴 경계값 — 상한 직전 1건은 통과한다', async () => {
  const db = fakeDb({ 'refineQuota/u1_2026-08-17': { count: DAILY_REFINE_LIMIT - 1 } });
  const r = await consumeDailyQuota(db, { uid: 'u1', now: new Date('2026-08-17T01:00:00Z') });
  assert.equal(r.ok, true, '상한 미만인데 막혔다 — off-by-one');
  assert.equal(r.used, DAILY_REFINE_LIMIT);
});

test('사용자가 다르면 서로의 한도를 깎지 않는다', async () => {
  const db = fakeDb({ 'refineQuota/u1_2026-08-17': { count: DAILY_REFINE_LIMIT } });
  const r = await consumeDailyQuota(db, { uid: 'u2', now: new Date('2026-08-17T01:00:00Z') });
  assert.equal(r.ok, true);
});

test('🔴 하루 경계는 **서울** 기준이다 — UTC로 세면 오전 9시에 초기화된다', () => {
  // 2026-08-17 15:30 UTC = 서울 2026-08-18 00:30 → 이미 다음 날이어야 한다.
  assert.equal(seoulDateKey(new Date('2026-08-17T15:30:00Z')), '2026-08-18');
  // 2026-08-17 14:30 UTC = 서울 23:30 → 아직 같은 날.
  assert.equal(seoulDateKey(new Date('2026-08-17T14:30:00Z')), '2026-08-17');
});

test('날짜가 바뀌면 새 문서에 센다 (전날 사용량이 이월되지 않는다)', async () => {
  const db = fakeDb({ 'refineQuota/u1_2026-08-17': { count: DAILY_REFINE_LIMIT } });
  const r = await consumeDailyQuota(db, { uid: 'u1', now: new Date('2026-08-17T15:30:00Z') });
  assert.equal(r.ok, true);
  assert.equal(db.store['refineQuota/u1_2026-08-18'].count, 1);
});

test('🔴 Zero Retention — 저장되는 필드는 카운트·메타뿐이다 (Spec 필수 5)', async () => {
  const db = fakeDb();
  await consumeDailyQuota(db, { uid: 'u1', now: new Date('2026-08-17T01:00:00Z') });
  const saved = db.store['refineQuota/u1_2026-08-17'];
  assert.deepEqual(
    Object.keys(saved).sort(),
    ['count', 'dateKey', 'uid', 'updatedAt'],
    '허용되지 않은 필드가 생겼다 — 본문이 들어갈 자리가 만들어졌는지 확인하라',
  );
  for (const [key, value] of Object.entries(saved)) {
    if (key === 'updatedAt') continue;
    assert.ok(
      typeof value === 'number' || String(value).length <= 64,
      `${key}가 너무 길다 — 본문이 실렸을 수 있다`,
    );
  }
});
