/**
 * 일일 상한(quota)·베타 지표(betaMetrics) 저장소 인터페이스 — 🔴 **1단계는 스텁이다.**
 *
 * 기존 서버(`functions/refineQuota.js`·`functions/betaMetrics.js`)는 Firestore에 쓴다(firebase-admin).
 * Worker에서는 firebase-admin을 못 쓰므로 저장소를 이 인터페이스 뒤로 숨기고, 1단계는 아무것도 저장하지 않는다.
 *
 * 인터페이스 (handler.js가 부르는 것 전부):
 * | 메서드 | 반환 | 기존 대응 |
 * |---|---|---|
 * | `consumeDailyQuota(uid)` | `{ ok, used, limit }` | `consumeDailyQuota(db, {uid})` |
 * | `recordDailyUser(uid)` | void | `recordDailyUser(db, uid)` |
 * | `recordRequest({mode, rejected?, fallback?, fallbackReason?, latencyMs})` | void | `recordRequest(db, …)` |
 *
 * 🔴 Zero Retention 경계는 그대로 — 넘기는 것은 uid·카운트·사유 코드·시간뿐, 본문은 이 인터페이스에 오지 않는다.
 *
 * TODO(2단계, L33 후속) — 선택지:
 * | 안 | 방법 | 장점 | 비용·위험 |
 * |---|---|---|---|
 * | A. Firestore REST 유지 | 서비스 계정 JSON을 Worker 시크릿에 두고, WebCrypto(RS256)로 JWT를 서명해 OAuth 토큰 교환(`oauth2.googleapis.com/token`) → Firestore REST `commit`(트랜잭션·`increment` 변환) | 대시보드·팀 기능이 **같은 Firestore**를 그대로 읽는다 | GCP 프로젝트가 계속 필요 — 🔴 체험판 종료(10-28) 후 Firestore만 Spark로 남는지 확인 필요(Firestore 자체는 Spark 무료 사용량 있음, 🔴 추정). 토큰 교환 1회/시간(fetch라 CPU 거의 없음) |
 * | B. Cloudflare D1 | `UPDATE … SET count = count + 1 … RETURNING`로 원자 증가 | 같은 계정 안, 무료 플랜 한도 내 | 대시보드가 Firestore를 읽으므로 지표가 두 곳으로 갈라진다 — 대시보드도 옮겨야 함 |
 * | C. Cloudflare KV | 키 `quota:<date>:<uid>` | 단순 | **원자 증가 없음**(최종 일관성) — 상한이 비용 방어선이라 동시 요청에 뚫린다. 상한용으로 부적합 |
 * | D. Durable Objects | uid별 객체가 카운트 | 원자적 | 무료 플랜 제공 범위 확인 필요(🔴 미확인) |
 */

/** 1단계 기본값 — 아무것도 세지 않는다. 🔴 배포하면 **일일 상한이 없다** — 공개 전에 2단계가 필요하다. */
export function createNoopUsageStore() {
  return {
    kind: 'noop',
    async consumeDailyQuota() {
      return { ok: true, used: null, limit: null };
    },
    async recordDailyUser() {},
    async recordRequest() {},
  };
}

/**
 * 테스트·로컬 확인용 — isolate 메모리에서만 센다. 🔴 운영 상한으로 쓰면 안 된다: isolate는 여러 개 뜨고
 * 수시로 내려가서 카운트가 흩어진다(캐시와 같은 이유, CLAUDE.md 「Cloud Functions에서는 덜 듣는다」).
 */
export function createMemoryUsageStore({ limit = 100, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const counts = new Map();
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
    async recordDailyUser(uid) {
      dailyUsers.add(`${today()}:${uid}`);
    },
    async recordRequest(input) {
      requests.push({ ...input });
    },
  };
}
