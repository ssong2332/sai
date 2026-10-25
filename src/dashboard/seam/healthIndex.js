/**
 * S18 / Spec §3 — 조직 협업 건강도 지수(Health Index).
 *
 * 공식: `Health Index = 100 - (정규화된 마찰 카운트)` (Spec §3, F-10/F-26 통합).
 * 🔴 2026-08-13 — 클로드 디자인 시안(`Sai Dashboard.dc.html`) 반영으로 정규화 기준을
 *    "전체 메시지 대비 마찰 비율"에서 **"관측된 신호(긍정+마찰) 대비 마찰 비율"**로 바꿨다.
 *    가상의 `totalMessages` 상수를 지어내는 대신, 화면에 실제로 표시되는 두 합계(긍정 신호
 *    합계·마찰 신호 합계)만으로 계산해 화면 수치와 공식이 항상 일치하게 했다.
 *
 * 🔴 이 함수는 **팀/조직 단위 집계만** 받는다 — 특정 개인의 식별자를 인자로 받지 않는다
 *    (필수 9 G1/G2와 같은 원칙: 서열·낙인을 유발하는 개인 단위 숫자를 만들지 않는다).
 */

/**
 * 🔴 **분모가 바뀌었다** (2026-08-15). 예전에는 `긍정+마찰`이었는데, 그 형태는 `ontime`
 *    (「제때 회신함」)처럼 마찰과 무관하게 쌓이는 **대량 긍정 신호**가 있어야 성립한다.
 *    그 지표는 **만들 수 없어서**(상대 메시지 도착 시각을 모른다) 뺐고, 남은 긍정 `clear`는
 *    정의상 `misread`를 넘을 수 없어 **Health가 50 근처에 갇혔다**(실측: 데모 50 / 45.1).
 *    Spec §3 원문이 `100 - (**정규화된** 마찰 카운트)`이므로 **다듬은 메시지 총수**로
 *    정규화한다 — "100건 다듬는 동안 마찰 9건 → 91"이 되어 지수가 다시 읽힌다.
 *
 * @param {{totalCount: number, frictionCount: number}} input
 *   `totalCount` = 다듬은 메시지 총수(분모). `frictionCount` = 마찰 신호 합계.
 * @returns {{frictionRatio: number, healthIndex: number|null}} 소수 1자리. 표본이 없으면 null.
 */
export function computeHealthMetrics({ totalCount, frictionCount }) {
  const friction = Number.isFinite(frictionCount) && frictionCount > 0 ? frictionCount : 0;
  const total = Number.isFinite(totalCount) && totalCount > 0 ? totalCount : 0;

  if (total <= 0) {
    /**
     * 🔴 **100을 주지 않는다** (2026-08-15 수정). 목업 시절에는 이 분기에 절대 닿지 않아서
     *    문제가 없었지만, 실데이터가 붙은 지금은 **아무도 안 쓰는 팀이 만점**으로 표시된다 —
     *    "사이를 안 쓸수록 건강한 팀"이라는 정반대 신호다. 표본이 없으면 지수도 없다.
     * 🔴 `healthIndex: null`이므로 **화면이 반드시 이 경우를 다뤄야 한다** — 숫자를 기대하고
     *    그리면 빈칸이 난다. 그것이 조용히 100을 보여주는 것보다 낫다.
     */
    return { frictionRatio: 0, healthIndex: null };
  }

  // 🔴 한 메시지가 마찰 둘을 동시에 낼 수 있어(오해 소지 + 하소연) 비율이 100%를 넘을 수 있다.
  //    아래 clamp가 지수를 0에서 막는다 — 음수 지수는 의미가 없다.
  const frictionRatio = Math.round((friction / total) * 1000) / 10;
  const healthIndex = Math.max(0, Math.min(100, Math.round((100 - frictionRatio) * 10) / 10));
  return { frictionRatio, healthIndex };
}
