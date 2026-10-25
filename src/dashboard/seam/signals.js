/**
 * 팀 신호 정의 — id·극성·라벨의 대시보드 쪽 단일 출처 (Spec §3).
 *
 * 🔴 2026-10-25 (0.1.21) — 예전 `dashboard/src/liveData.js`. 대시보드가 확장 페이지(`src/dashboard/`)로
 *    들어오면서 **주소창(`#sai=`)으로 팀 지표를 받는 경로를 없앴다** — 팀 합계가 URL·방문 기록에 남지 않는다.
 *    `readLiveScenarios`·`coverageDaysOf`는 그 경로와 함께 지웠고, 여기에는 신호 정의만 남았다.
 *    웹 `/dashboard/`는 예시 데이터 전용이다(`dashboard/src/main.js`).
 * 🔴 팀 단위 합계만 다룬다. 사람을 가리키는 값은 없다(Spec 필수 9 G1/G2).
 */

/** `src/lib/friction.js`의 `FRICTION_EVENTS`·`EVENT_LABELS`와 같아야 한다. */
const EVENTS = [
  { id: 'clear', kind: 'positive', label: '명확한 요청으로 교정됨', desc: '오해 소지 표현이 교정 과정에서 정리됨' },
  { id: 'schedule', kind: 'positive', label: '예약 제안을 수락함', desc: '오프타임 전송 대신 예약을 선택' },
  { id: 'misread', kind: 'friction', label: '오해 소지 표현 발생', desc: '교정 전 원문 기준, 교정 후 반영됨' },
  { id: 'venting', kind: 'friction', label: '하소연으로 감지된 메시지', desc: '반복된 불만·피로감 표현 — 메시지 단위 집계' },
  { id: 'forceOffHours', kind: 'friction', label: '오프타임 강행 시도', desc: '긴급도를 올려 예약 제한을 우회' },
  // 2026-08-16 추가 — 이미 판정하고 있던 신호 3종.
  { id: 'sensitiveBlocked', kind: 'positive', label: '민감정보 전송을 막음', desc: '보내기 전에 가드가 걸러낸 건수' },
  { id: 'urgencyGap', kind: 'friction', label: '긴급도가 실제와 다름', desc: '완곡한 표현이 실제 긴급도를 가린 메시지' },
  { id: 'missing', kind: 'friction', label: '기한·영향이 빠진 요청', desc: '무엇을 언제까지인지 없이 나간 요청' },
  /**
   * 2026-10-25 추가(L34) — **맥락 카운트**. 🔴 `kind: 'context'`는 긍정·마찰 막대와 추이,
   *    건강도 지수 어디에도 들어가지 않는다(`POSITIVE_IDS`·`FRICTION_IDS`에서 빠진다).
   *    시나리오의 `context` 배열로만 넘어간다.
   */
  { id: 'decoded', kind: 'context', label: '뜻 풀기한 메시지', desc: '받은 메시지를 풀어 본 횟수' },
  { id: 'decodeUrgencyGap', kind: 'context', label: '겉보기와 실제 긴급도가 다른 받은 메시지', desc: '표현은 가벼운데 실제로는 급했던(또는 그 반대) 메시지' },
  { id: 'urgencyCritical', kind: 'context', label: '긴급(CRITICAL)으로 다듬음', desc: '다듬기에 최종 적용된 긴급도' },
  { id: 'urgencyNormal', kind: 'context', label: '보통(NORMAL)으로 다듬음', desc: '다듬기에 최종 적용된 긴급도' },
  { id: 'urgencyLow', kind: 'context', label: '낮음(LOW)으로 다듬음', desc: '다듬기에 최종 적용된 긴급도' },
  { id: 'teamGlossaryApplied', kind: 'context', label: '팀 용어집이 적용된 메시지', desc: '팀 용어가 1개 이상 반영된 다듬기(메시지 단위)' },
];

/**
 * 🔴 **극성별 id 목록을 여기서 내보낸다** (2026-08-16 사용자 지적 ⑦).
 *    추이 차트가 `['clear','schedule']`·`['misread','venting','forceOffHours']`를 **손으로
 *    적어 두고 있어서**, 신호 3종을 추가했을 때 막대 차트·건강도에는 반영되고 **추이에만
 *    빠졌다.** 22건짜리 신호가 추이에서는 아예 없는 것처럼 보였다.
 * 🔴 목록을 두 벌 두지 않는 것이 유일한 재발 방지책이다 — 다음에 신호를 늘려도 여기 한 줄이면 된다.
 */
/** id → 화면 라벨. 🔴 추이 툴팁이 신호 이름을 말하려면 필요하다(2026-08-16 ③). */
export const EVENT_LABEL = Object.fromEntries(EVENTS.map((e) => [e.id, e.label]));

export const POSITIVE_IDS = EVENTS.filter((e) => e.kind === 'positive').map((e) => e.id);
export const FRICTION_IDS = EVENTS.filter((e) => e.kind === 'friction').map((e) => e.id);
export const CONTEXT_IDS = EVENTS.filter((e) => e.kind === 'context').map((e) => e.id);
/** 테스트가 확장·서버 키 집합과 대조하는 데 쓴다. */
export const EVENT_IDS = EVENTS.map((e) => e.id);

/**
 * 날짜별 원자료에서 **최근 N일**만 합산한다 (2026-08-16 기간 선택).
 * 🔴 오늘 기준으로 자른다 — 확장이 보낸 날짜 키가 로컬 시각 기준(`friction.js`)이라 같은 규칙이다.
 */
export function sumRecentDays(byDate, days) {
  const out = {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  for (const [dateKey, counts] of Object.entries(byDate ?? {})) {
    if (dateKey < cutoffKey) continue;
    for (const [key, value] of Object.entries(counts ?? {})) {
      if (typeof value !== 'number') continue;
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}
