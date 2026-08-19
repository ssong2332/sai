/**
 * 사용자당 일일 교정 상한 (2026-08-17 신설).
 *
 * 🔴 **왜 필요한가**: `refineV1`이 인증 없이 열려 있어 URL만 알면 누구나 우리 LLM 키를 썼다.
 *    인증(`requireUid`)이 그 문을 닫지만, **인증만으로는 비용이 막히지 않는다** — 로그인한
 *    사용자 한 명이 스크립트로 수천 건을 태울 수 있고, provider가 OpenAI(유료)로 바뀐
 *    2026-08-17부터는 그게 곧 청구서다.
 *
 * 🔴 **Zero Retention (Spec 필수 5)**: 여기 저장되는 것은 `uid`·`count`·타임스탬프뿐이다.
 *    메시지 본문·교정문·언어쌍 어느 것도 들어오지 않는다. 이 파일에 본문 인자를 받는 함수를
 *    추가하지 않는다 — 세는 데 본문이 필요할 이유가 없다.
 *
 * 🔴 **트랜잭션으로 센다.** 읽고-더하고-쓰기를 나눠 하면 동시 요청이 같은 값을 읽어 상한을
 *    넘긴다. 상한은 비용 방어선이므로 "대충 맞는" 값이면 의미가 없다.
 *
 * 🔴 **날짜 경계는 서울 기준이다.** UTC로 세면 한국 사용자에게 상한이 오전 9시에 초기화된다 —
 *    "하루"가 사용자의 하루와 어긋나면 상한을 설명할 수 없다.
 */

/**
 * 기본 상한.
 *
 * 🔴 **계정 전체 한도에서 역산한 값이다** (2026-08-17 실측). OpenAI 계정이 **하루 약 50건**을
 *    준다(`x-ratelimit-*` 헤더 2회 측정 → 충전 속도 ≈ 0.036건/분 ≈ 50건/일). 이 50건은
 *    **사용자별이 아니라 계정 전체**다. 그래서 1인당 상한은 「몇 명이 나눠 쓸 것인가」로 정해진다:
 *
 *    | 1인당 | 동시에 쓸 수 있는 사람 |
 *    |---|---|
 *    | **30 (현재 — 촬영용)** | **1~2명** ← 촬영자가 상한에 먼저 걸리지 않게 한 값 |
 *    | 10 | 약 5명 ← 테스터 여럿이 나눠 쓸 때의 값 |
 *
 * 🔴 **2026-08-18 촬영을 위해 10 → 30으로 올렸다.** 사용자 상한이 10이면 **재촬영 두어 번에
 *    촬영자 본인이 먼저 막힌다.** 계정 한도(약 50/일)가 어차피 위에서 막으므로 이 값을 올려도
 *    비용이 새지는 않는다 — 다만 **여러 명이 동시에 쓰면 한 명이 계정을 거의 다 쓸 수 있다.**
 *    촬영이 끝나면 10으로 되돌리는 것을 검토한다.
 *
 * 🔴 **2026-08-19 30 → 100** (사용자 결정). 30에 실제로 막혔다 — 그런데 이 카운트는
 *    **LLM을 부르기 전에** 올라가므로, OpenAI 한도 때문에 실패한 교정까지 30건에 포함됐다.
 *    즉 **성공 30건이 아니라 시도 30건**에서 막힌 것이다.
 *    🔴 **상한이 계정 한도보다 낮으면 방어선이 아니라 방해물이다.** OpenAI RPD 50 · Gemini 20이
 *       위에서 막으므로, 혼자 쓰는 동안 100은 실질적으로 「우리 쪽에서는 안 막는다」와 같다.
 *       여러 명이 동시에 쓰는 상황이 되면 **사람 수로 나눈 값**으로 되돌려야 한다(위 표).
 *
 * 🔴 **이 값을 올려도 계정 한도는 올라가지 않는다.** 계정 한도는 OpenAI **사용 티어**가 정하며
 *    코드나 콘솔에서 임의의 숫자로 지정할 수 없다(2026-08-18 확인). 여기만 키우면 사용자에게
 *    보이는 오류가 「오늘 한도를 다 썼어요」(429·우리 판정, 원인이 분명)에서
 *    **「교정하지 못했어요」(폴백·원인 불명)**로 바뀔 뿐이다 — 더 나쁜 실패다.
 */
export const DAILY_REFINE_LIMIT = 100;

/** 상한 초과를 호출부가 구분할 수 있게 하는 사유 코드. */
export const QUOTA_REASONS = {
  OVER_LIMIT: 'daily-limit',
};

/**
 * 서울 기준 `YYYY-MM-DD`.
 * 🔴 `toISOString()`을 쓰지 않는다 — 그건 UTC다.
 */
export function seoulDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * 오늘 사용량을 1 늘리고, 상한을 넘으면 늘리지 않고 거절한다.
 *
 * @param {object} db Firestore 인스턴스 (Admin SDK — 규칙을 우회하므로 서버 전용).
 * @param {object} args
 * @param {string} args.uid
 * @param {number} [args.limit]
 * @param {Date} [args.now]
 * @returns {Promise<{ok: boolean, used: number, limit: number}>}
 */
export async function consumeDailyQuota(db, { uid, limit = DAILY_REFINE_LIMIT, now = new Date() }) {
  const dateKey = seoulDateKey(now);
  const ref = db.collection('refineQuota').doc(`${uid}_${dateKey}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? Number(snap.data()?.count ?? 0) : 0;

    if (used >= limit) return { ok: false, used, limit };

    // 🔴 `set(..., {merge:true})`다. `update()`는 문서가 없으면 던진다 — 그날 첫 요청이 전부 실패한다.
    tx.set(ref, { uid, dateKey, count: used + 1, updatedAt: new Date() }, { merge: true });
    return { ok: true, used: used + 1, limit };
  });
}
