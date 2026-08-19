/**
 * 캘린더 빈 시간 필터 (S23 / Spec 권장 12).
 *
 * 🔴 **우리가 볼 수 있는 것은 "내 캘린더"뿐이다.** Google FreeBusy로 남의 일정을 보려면 그 사람이
 *    나에게 캘린더를 공유했거나 같은 조직이어야 한다. 일반적인 국경 간 협업 상대는 둘 다 아니다.
 *    → 그래서 이 필터는 **내가 바쁜 시간을 빼는 것**까지만 한다. 화면 문구도 그렇게 쓴다.
 *      **"상대가 비어 있는 시간"이라고 절대 말하지 않는다** (`overlap.js` 헤더와 같은 원칙).
 *
 * 🔴 **FreeBusy는 일정 제목·참석자를 주지 않는다 — 바쁜 구간의 시각만 준다.** 이 API를 고른 이유가
 *    그것이다(`events.list`를 쓰면 남의 회의 제목까지 받게 된다). 받는 데이터에 본문이 없으므로
 *    Zero Retention(Spec 필수 5)을 **설계로** 지킨다. 게다가 아래 함수는 그 시각조차 저장하지
 *    않고 필터링에만 쓴다.
 *
 * 🔴 이 파일은 네트워크를 모른다 — 순수 함수다. 조회는 `src/lib/calendarClient.js`.
 */

/** 회의 하나가 차지한다고 볼 시간(분). 슬롯 자체는 정시 단위라 기본 60분으로 잡는다. */
export const DEFAULT_MEETING_MINUTES = 60;

/**
 * `[start, end)` 두 구간이 겹치는지. 🔴 경계는 **닿아도 겹치지 않는다** — 10시에 끝나는 회의와
 * 10시에 시작하는 회의는 연달아 할 수 있다. `>=`/`<=`로 쓰면 멀쩡한 시간이 통째로 사라진다.
 */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * ISO 문자열 구간 배열을 밀리초 구간으로. 파싱 실패한 것은 **버린다** —
 * 🔴 깨진 구간을 0으로 읽으면 1970년에 바쁜 것이 되어 아무 슬롯도 안 지워지거나 전부 지워진다.
 */
function toMillisRanges(intervals) {
  const out = [];
  for (const item of intervals ?? []) {
    const start = Date.parse(item?.start);
    const end = Date.parse(item?.end);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    out.push([start, end]);
  }
  return out;
}

/**
 * 내 일정과 겹치는 슬롯을 뺀다.
 *
 * @param {object[]} slots `findMeetingSlots()`의 `slots`. `startUtcISO`를 읽는다.
 * @param {{start: string, end: string}[]} busy FreeBusy가 준 바쁜 구간(ISO).
 * @param {object} [options]
 * @param {number} [options.meetingMinutes] 회의 길이. 기본 60.
 * @returns {{slots: object[], removed: number, checked: boolean}}
 *   🔴 `checked`는 **실제로 캘린더를 확인했는지**다. 연결하지 않았거나 조회에 실패하면 false이며,
 *      이때 화면은 "빈 시간을 확인했다"고 말하면 안 된다 — 아무것도 안 빼고 통과시킨 것뿐이다.
 *      `removed`가 0인 것과 `checked`가 false인 것은 **완전히 다른 상태**다.
 */
export function excludeBusySlots(slots, busy, { meetingMinutes = DEFAULT_MEETING_MINUTES } = {}) {
  const list = Array.isArray(slots) ? slots : [];
  if (busy == null) return { slots: list, removed: 0, checked: false };

  const ranges = toMillisRanges(busy);
  const durationMs = Math.max(1, meetingMinutes) * 60_000;

  const kept = list.filter((slot) => {
    const start = Date.parse(slot?.startUtcISO);
    if (Number.isNaN(start)) return true; // 읽을 수 없는 슬롯은 함부로 지우지 않는다.
    const end = start + durationMs;
    return !ranges.some(([busyStart, busyEnd]) => overlaps(start, end, busyStart, busyEnd));
  });

  return { slots: kept, removed: list.length - kept.length, checked: true };
}

/**
 * 화면 문구 — 🔴 **"상대가 비어 있다"고 말하지 않는다.** 우리가 확인한 것은 내 캘린더뿐이다.
 *
 * @param {{removed: number, checked: boolean}} result `excludeBusySlots()` 결과.
 */
export function busyNotice({ removed, checked }) {
  if (!checked) return '내 캘린더는 확인하지 않았어요 — 업무시간이 겹치는 시간만 보여드려요';
  if (removed === 0) return '내 캘린더에 겹치는 일정은 없었어요';
  return `내 일정과 겹치는 ${removed}개를 뺐어요 — 상대 일정은 확인할 수 없어요`;
}
