/**
 * 확장이 넘겨준 **실제 팀 지표** 읽기 (Spec §3, 2026-08-15).
 *
 * 🔴 **왜 URL 프래그먼트인가.** 이 대시보드는 로그인이 없는 별도 웹페이지다. Firestore를 직접
 *    읽게 하려면 이 페이지에도 인증을 붙여야 하는데, `firestore.rules`는 팀원만 읽게 하므로
 *    인증 없이 열어 주는 순간 **팀 id만 알면 남의 조직 지표가 공개된다.** 그래서 읽기는 이미
 *    자격이 있는 **확장**이 하고, 집계 결과만 이쪽으로 넘긴다.
 * 🔴 프래그먼트(`#`)는 쿼리스트링과 달리 **서버로 전송되지 않는다** — 호스팅 접근 로그에
 *    남지 않는다. 넘어오는 값은 정수 합계와 팀 이름뿐이고, 개인 식별자는 애초에 존재하지
 *    않는다(마찰 문서에 uid를 남기지 않는 설계 — `src/lib/friction.js`).
 * 🔴 **넘어온 값을 그대로 믿지 않는다.** 주소창은 누구나 고칠 수 있다. 화이트리스트 밖 키와
 *    정수가 아닌 값은 버린다 — 이 페이지가 임의 문자열을 화면에 그리는 경로를 만들지 않는다.
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

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : 0;
}

/**
 * 주소의 `#sai=<base64>`를 시나리오 형태로 바꾼다.
 * @returns {{label: string, teamName: string, positive: object[], friction: object[]}|null}
 *   프래그먼트가 없거나 형태가 깨졌으면 null — 그러면 호출자가 목업으로 간다.
 */
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

function toScenario(entry) {
  const counts = entry?.counts ?? {};
  const rows = EVENTS.map((event) => ({ ...event, count: safeCount(counts[event.id]) }));
  const refined = safeCount(counts.refined);
  return {
    /**
     * 🔴 **빈 팀도 시나리오로 남긴다** (2026-08-16). 빼 버리면 그 팀을 고른 사용자에게
     *    **다른 팀 지표**가 열린다. 대신 `empty`로 표시해 화면이 "아직 없다"고 말하게 한다.
     */
    empty: refined === 0 && rows.every((row) => row.count === 0),
    label: '최근 30일',
    // 🔴 날짜별 원자료 — 기간을 다시 계산할 수 있어야 「최근 7일」이 눌러도 바뀌는 버튼이 된다.
    byDate: entry?.byDate ?? {},
    teamId: String(entry?.teamId ?? ''),
    teamName: typeof entry?.teamName === 'string' ? entry.teamName.slice(0, 40) : '우리 팀',
    // 🔴 건강도 지수의 **분모** — 다듬은 메시지 총수(Spec §3). 막대로 그리지 않는다.
    total: safeCount(counts.refined),
    positive: rows.filter((row) => row.kind === 'positive'),
    friction: rows.filter((row) => row.kind === 'friction'),
  };
}

/**
 * 주소의 `#sai=<base64>`를 시나리오 **목록**으로 바꾼다.
 *
 * 🔴 **여러 팀이 올 수 있다** (2026-08-16). 대시보드는 로그인이 없어 스스로 팀을 바꿔 읽지
 *    못하므로, 확장이 볼 수 있는 팀을 전부 실어 보내고 여기서 드롭다운으로 전환한다.
 *    맨 앞이 사이드패널에서 보고 있던 팀이다.
 * @returns {Array<object>} 비었으면 호출자가 목업으로 간다.
 */
export function readLiveScenarios(hash = globalThis.location?.hash ?? '') {
  const match = /[#&]sai=([^&]+)/.exec(hash);
  if (!match) return [];

  let parsed;
  try {
    // 🔴 `decodeURIComponent(escape(...))` — 확장 쪽 인코딩과 짝이다(한글 팀 이름 보존).
    parsed = JSON.parse(decodeURIComponent(escape(atob(match[1]))));
  } catch {
    return []; // 손상된 링크는 조용히 데모로 되돌린다 — 깨진 화면을 그리지 않는다.
  }

  const list = Array.isArray(parsed?.teams) ? parsed.teams : [];
  return list.map(toScenario);
}
