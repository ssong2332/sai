import { consumeDailyQuota, DAILY_REFINE_LIMIT, quotaExpireAt, seoulDateKey } from '../../../functions/refineQuota.js';
import { recordDailyUser, recordRequest } from '../../../functions/betaMetrics.js';
import { googleClientsFromEnv } from './google/clients.js';
import { costMicros, decideQuality, MONTHLY_HARD_STOP_MICROS, seoulMonthKey } from './qualityAllowance.js';

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
    async getBilling() {
      return null;
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
  const replies = new Map(); // `${날짜}:${uid}` → 회신 초안 횟수(무료 한도가 있을 때만 센다)
  const budget = new Map(); // 달 → 추정 비용(백만분의 1달러)
  const billing = new Map(); // uid → billing 문서(테스트가 setBilling으로 넣는다)
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
    async admit(uid, { quality = null, limits = null, replyLimit = null } = {}) {
      const key = `${today()}:${uid}`;
      const used = (counts.get(key) ?? 0) + 1;
      const dailyLimit = limits?.daily ?? limit;
      if (used > dailyLimit) return { ok: false, used: used - 1, limit: dailyLimit };
      // 2026-11-05 무료 회신 초안 하루 N회(`PLAN_FEATURES.replyDaily`) — 하루 횟수 안에서 따로 센다. 넘으면 횟수를 깎지 않는다.
      const replyUsed = replies.get(key) ?? 0;
      if (replyLimit != null && replyUsed >= replyLimit) return { ok: false, reason: 'reply-limit', used: used - 1, limit: replyLimit };
      const m = month();
      const monthMicros = budget.get(m) ?? startMicros;
      if (monthMicros >= MONTHLY_HARD_STOP_MICROS) return { ok: false, reason: 'monthly-limit', used: used - 1, limit: dailyLimit };
      const premiumUsed = quality ? { [quality]: premium.get(`${key}:${quality}`) ?? 0 } : {};
      const decided = decideQuality({ requested: quality, premiumUsed, monthMicros, ...(limits ? { limits } : {}) });
      counts.set(key, used);
      if (replyLimit != null) replies.set(key, replyUsed + 1);
      if (decided.quality && !decided.downgrade && decided.quality !== 'fast') {
        premium.set(`${key}:${decided.quality}`, (premiumUsed[decided.quality] ?? 0) + 1);
      }
      budget.set(m, monthMicros + costMicros(decided.quality));
      return { ok: true, used, limit: dailyLimit, ...decided };
    },
    async getBilling(uid) {
      return billing.get(uid) ?? null;
    },
    setBilling(uid, doc) {
      billing.set(uid, doc);
    },
    monthMicros: () => budget.get(month()) ?? startMicros,
    async getMonthMicros() {
      return budget.get(month()) ?? startMicros;
    },
    async addBudget(micros) {
      if (!(micros > 0)) return;
      const m = month();
      budget.set(m, (budget.get(m) ?? startMicros) + micros);
    },
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
    admit: (uid, { quality = null, limits = null, replyLimit = null } = {}) =>
      admitFirestore(db, { uid, quality, limit: limits?.daily ?? limit, limits, replyLimit, now: now() }),
    // 결제(`billing.js`) — 요금제 판정용 구독 문서. 요청당 읽기 1회.
    getBilling: async (uid) => {
      const snap = await db.collection('billing').doc(uid).get();
      return snap.exists ? snap.data() ?? null : null;
    },
    recordDailyUser: (uid) => recordDailyUser(db, uid, now()),
    recordRequest: (input) => recordRequest(db, input, now()),
    addBudget: (micros) => addBudgetFirestore(db, micros, now()),
    // 2026-11-02 — 이달 추정(`/health/budget` 단계 판정용). 문서 읽기 1회.
    getMonthMicros: async () => {
      const snap = await db.collection('budgetMonthly').doc(seoulMonthKey(now())).get();
      return snap.exists ? Number(snap.data()?.micros ?? 0) : 0;
    },
  };
}

/**
 * 하루 상한 + 품질 모드 허용량을 **한 트랜잭션**으로(동시 요청이 같은 값을 읽어 넘기지 않게 — `refineQuota.js`와 같은 이유).
 * 문서 2개: `refineQuota/{uid}_{날짜}`(기존 모양 + `premium.{standard|deep}`) · `budgetMonthly/{YYYY-MM}`(`micros`, uid 없음).
 * 🔴 쓰기가 요청당 1개 늘어난다(Spark 하루 쓰기 2만 — Spec §0 「비용 상한」).
 */
async function admitFirestore(db, { uid, quality, limit, limits = null, replyLimit = null, now }) {
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
    // 2026-11-05 무료 회신 초안 하루 N회 — 같은 문서의 `reply` 칸(숫자만, 본문 없음). 넘으면 아무것도 쓰지 않는다.
    const replyUsed = Number(q.reply ?? 0);
    if (replyLimit != null && replyUsed >= replyLimit) return { ok: false, reason: 'reply-limit', used, limit: replyLimit };
    const monthMicrosNow = budgetSnap.exists ? Number(budgetSnap.data()?.micros ?? 0) : 0;
    // 🔴 2026-11-02 — 이달 추정이 멈춤선 이상이면 아무것도 쓰지 않고 거절한다(횟수도 깎지 않는다).
    if (monthMicrosNow >= MONTHLY_HARD_STOP_MICROS) return { ok: false, reason: 'monthly-limit', used, limit };
    const premiumUsed = Object.fromEntries(Object.entries(q.premium ?? {}).map(([k, v]) => [k, Number(v ?? 0)]));
    const monthMicros = budgetSnap.exists ? Number(budgetSnap.data()?.micros ?? 0) : 0;
    const decided = decideQuality({ requested: quality, premiumUsed, monthMicros, ...(limits ? { limits } : {}) });
    const quotaDoc = { uid, dateKey, count: used + 1, updatedAt: now, expireAt: quotaExpireAt(dateKey) };
    if (replyLimit != null) quotaDoc.reply = replyUsed + 1;
    if (decided.quality && !decided.downgrade && decided.quality !== 'fast') {
      quotaDoc.premium = { [decided.quality]: (premiumUsed[decided.quality] ?? 0) + 1 };
    }
    tx.set(quotaRef, quotaDoc, { merge: true });
    tx.set(budgetRef, { monthKey, micros: monthMicros + costMicros(decided.quality), updatedAt: now }, { merge: true });
    return { ok: true, used: used + 1, limit, ...decided };
  });
}

/**
 * 받은 뒤의 추가 호출 비용(재호출·폴오버)을 이달 추정에 더한다 (2026-11-02). 금액만 — uid·본문 없음.
 * 🔴 추가 호출이 있었을 때만 불린다 — 대부분의 요청은 쓰기가 늘지 않는다(Spark 하루 쓰기 2만).
 */
async function addBudgetFirestore(db, micros, now) {
  if (!(micros > 0)) return;
  const monthKey = seoulMonthKey(now);
  const ref = db.collection('budgetMonthly').doc(monthKey);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.micros ?? 0) : 0;
    tx.set(ref, { monthKey, micros: current + micros, updatedAt: now }, { merge: true });
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
