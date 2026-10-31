import { consumeDailyQuota, DAILY_REFINE_LIMIT, quotaExpireAt, seoulDateKey } from '../../../functions/refineQuota.js';
import { recordDailyUser, recordRequest } from '../../../functions/betaMetrics.js';
import { googleClientsFromEnv } from './google/clients.js';
import { costMicros, decideQuality, seoulMonthKey } from './qualityAllowance.js';

/**
 * 일일 상한(quota)·베타 지표(betaMetrics) 저장소 인터페이스 — 2026-10-26부터 Firestore(아래 표), 시크릿이 없으면 스텁.
 *
 * 기존 서버(`functions/refineQuota.js`·`functions/betaMetrics.js`)는 Firestore에 쓴다(firebase-admin).
 * Worker에서는 firebase-admin을 못 쓰므로 저장소를 이 인터페이스 뒤로 숨기고, 1단계는 아무것도 저장하지 않는다.
 *
 * 인터페이스 (handler.js가 부르는 것 전부):
 * | 메서드 | 반환 | 기존 대응 |
 * |---|---|---|
 * | `consumeDailyQuota(uid)` | `{ ok, used, limit }` | `consumeDailyQuota(db, {uid})` |
 * | `admit(uid, {quality})` | `{ ok, used, limit, quality, downgrade }` — 하루 상한 + 품질 모드 허용량(`qualityAllowance.js`) | 없음(Worker 전용, 2026-10-31) |
 * | `recordDailyUser(uid)` | void | `recordDailyUser(db, uid)` |
 * | `recordRequest({mode, rejected?, fallback?, fallbackReason?, latencyMs})` | void | `recordRequest(db, …)` |
 *
 * 🔴 Zero Retention 경계는 그대로 — 넘기는 것은 uid·카운트·사유 코드·시간뿐, 본문은 이 인터페이스에 오지 않는다.
 *
 * 🔴 2026-10-26 결정(사용자 승인 — 안 A): **Firestore REST**. 팀 API를 옮기려면 어차피 서비스 계정으로 Firestore에 써야 하고
 *    (규칙상 클라이언트 쓰기 금지), 대시보드가 같은 Firestore를 읽는다. D1·KV·Durable Objects는 지표가 두 곳으로 갈라져 탈락.
 *    판정 코드는 Functions 것을 **그대로** 부른다(`functions/refineQuota.js`·`betaMetrics.js`) — 상한 값·문서 모양·TTL이 같다.
 *
 * | env | 저장소 |
 * |---|---|
 * | `GOOGLE_SERVICE_ACCOUNT` 시크릿 있음 | `firestore` — `refineQuota/{uid}_{서울날짜}`(하루 `DAILY_REFINE_LIMIT` · 상위 모드 `premium.*`)·`budgetMonthly/{서울 YYYY-MM}`(이달 추정 비용, uid 없음)·`betaMetrics/{서울날짜}` |
 * | 없음 | `noop` — 🔴 **상한 없음**. `/health`의 `usageStore`로 드러난다(배포 뒤 반드시 `firestore`인지 본다) |
 */

/** 스텁 — 아무것도 세지 않는다. 🔴 이 상태로 배포하면 **일일 상한이 없다** (`GOOGLE_SERVICE_ACCOUNT` 없음). */
export function createNoopUsageStore() {
  return {
    kind: 'noop',
    async consumeDailyQuota() {
      return { ok: true, used: null, limit: null };
    },
    // 🔴 세지 않으므로 강등도 없다 — 운영에서 이 상태면 `/health` usageStore가 `noop`으로 드러난다(콘솔 한도가 막는다).
    async admit(_uid, { quality = null } = {}) {
      return { ok: true, used: null, limit: null, quality, downgrade: null };
    },
    async recordDailyUser() {},
    async recordRequest() {},
  };
}

/**
 * 테스트·로컬 확인용 — isolate 메모리에서만 센다. 🔴 운영 상한으로 쓰면 안 된다: isolate는 여러 개 뜨고
 * 수시로 내려가서 카운트가 흩어진다(캐시와 같은 이유, CLAUDE.md 「Cloud Functions에서는 덜 듣는다」).
 */
export function createMemoryUsageStore({
  limit = 100,
  today = () => new Date().toISOString().slice(0, 10),
  month = () => new Date().toISOString().slice(0, 7),
  monthMicros: startMicros = 0,
} = {}) {
  const counts = new Map();
  const premium = new Map(); // `${날짜}:${uid}:${모드}` → 횟수
  const budget = new Map(); // 달 → 추정 비용(백만분의 1달러)
  const requests = [];
  const dailyUsers = new Set();
  return {
    kind: 'memory',
    requests,
    dailyUsers,
    async consumeDailyQuota(uid) {
      const key = `${today()}:${uid}`;
      const used = (counts.get(key) ?? 0) + 1;
      if (used > limit) return { ok: false, used: used - 1, limit };
      counts.set(key, used);
      return { ok: true, used, limit };
    },
    async admit(uid, { quality = null } = {}) {
      const key = `${today()}:${uid}`;
      const used = (counts.get(key) ?? 0) + 1;
      if (used > limit) return { ok: false, used: used - 1, limit };
      const m = month();
      const monthMicros = budget.get(m) ?? startMicros;
      const premiumUsed = quality ? { [quality]: premium.get(`${key}:${quality}`) ?? 0 } : {};
      const decided = decideQuality({ requested: quality, premiumUsed, monthMicros });
      counts.set(key, used);
      if (decided.quality && !decided.downgrade && decided.quality !== 'fast') {
        premium.set(`${key}:${decided.quality}`, (premiumUsed[decided.quality] ?? 0) + 1);
      }
      budget.set(m, monthMicros + costMicros(decided.quality));
      return { ok: true, used, limit, ...decided };
    },
    monthMicros: () => budget.get(month()) ?? startMicros,
    async recordDailyUser(uid) {
      dailyUsers.add(`${today()}:${uid}`);
    },
    async recordRequest(input) {
      requests.push({ ...input });
    },
  };
}

/**
 * Firestore 저장소 — Functions와 **같은 함수·같은 문서**. `now`는 호출마다 읽는다(날짜 경계는 서울).
 * @param {{db: object, limit?: number, now?: () => Date}} opts
 */
export function createFirestoreUsageStore({ db, limit = DAILY_REFINE_LIMIT, now = () => new Date() }) {
  return {
    kind: 'firestore',
    consumeDailyQuota: (uid) => consumeDailyQuota(db, { uid, limit, now: now() }),
    admit: (uid, { quality = null } = {}) => admitFirestore(db, { uid, quality, limit, now: now() }),
    recordDailyUser: (uid) => recordDailyUser(db, uid, now()),
    recordRequest: (input) => recordRequest(db, input, now()),
  };
}

/**
 * 하루 상한 + 품질 모드 허용량을 **한 트랜잭션**으로(동시 요청이 같은 값을 읽어 넘기지 않게 — `refineQuota.js`와 같은 이유).
 * 문서 2개: `refineQuota/{uid}_{날짜}`(기존 모양 + `premium.{standard|deep}`) · `budgetMonthly/{YYYY-MM}`(`micros`, uid 없음).
 * 🔴 쓰기가 요청당 1개 늘어난다(Spark 하루 쓰기 2만 — Spec §0 「비용 상한」).
 */
async function admitFirestore(db, { uid, quality, limit, now }) {
  const dateKey = seoulDateKey(now);
  const monthKey = seoulMonthKey(now);
  const quotaRef = db.collection('refineQuota').doc(`${uid}_${dateKey}`);
  const budgetRef = db.collection('budgetMonthly').doc(monthKey);
  return db.runTransaction(async (tx) => {
    const quotaSnap = await tx.get(quotaRef);
    const budgetSnap = await tx.get(budgetRef);
    const q = quotaSnap.exists ? quotaSnap.data() ?? {} : {};
    const used = Number(q.count ?? 0);
    if (used >= limit) return { ok: false, used, limit };
    const premiumUsed = Object.fromEntries(Object.entries(q.premium ?? {}).map(([k, v]) => [k, Number(v ?? 0)]));
    const monthMicros = budgetSnap.exists ? Number(budgetSnap.data()?.micros ?? 0) : 0;
    const decided = decideQuality({ requested: quality, premiumUsed, monthMicros });
    const quotaDoc = { uid, dateKey, count: used + 1, updatedAt: now, expireAt: quotaExpireAt(dateKey) };
    if (decided.quality && !decided.downgrade && decided.quality !== 'fast') {
      quotaDoc.premium = { [decided.quality]: (premiumUsed[decided.quality] ?? 0) + 1 };
    }
    tx.set(quotaRef, quotaDoc, { merge: true });
    tx.set(budgetRef, { monthKey, micros: monthMicros + costMicros(decided.quality), updatedAt: now }, { merge: true });
    return { ok: true, used: used + 1, limit, ...decided };
  });
}

const NOOP = createNoopUsageStore();
const memo = { db: null, store: null };

/** env → 저장소(위 표). 같은 db면 같은 저장소를 돌려준다. */
export function usageStoreFromEnv(env, opts = {}) {
  const clients = googleClientsFromEnv(env, opts);
  if (!clients) return NOOP;
  if (memo.db !== clients.db) {
    memo.db = clients.db;
    memo.store = createFirestoreUsageStore({ db: clients.db });
  }
  return memo.store;
}
