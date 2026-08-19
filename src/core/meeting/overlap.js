/**
 * 회의 시간 추천 — 타임존 겹침 계산 (S23 / Spec 권장 12).
 *
 * 🔴 **캘린더 빈 시간 감지는 아직 하지 않는다 — 미구현이다(2026-08-13 사용자 확인: 연동 기능
 *    전체가 아직 없음)**. S14의 자동 예약 전송처럼 *원리적으로* 막힌 것이 아니라, 선행 작업이
 *    끝나지 않았을 뿐이다:
 *    - **Google Calendar FreeBusy**: GCP OAuth 클라이언트 ID + 동의 화면 + `calendar.readonly`
 *      스코프 + `chrome.identity` 권한이 필요하다.
 *    - **Outlook/Microsoft 365**: Graph `getSchedule` — Azure 앱 등록 + 동의가 필요하다.
 *    → 그때까지는 **"상대가 비어 있는 시간"이라고 말하지 않는다.** 지금 정직하게 말할 수 있는
 *      것은 **"양쪽 업무시간이 겹치는 시간"**뿐이고, 화면 문구도 그렇게 쓴다.
 *    → 연동이 붙으면 이 파일은 그대로 두고 `findMeetingSlots()`의 결과에서 busy 구간을 빼는
 *      필터를 **바깥에** 두면 된다 — 그래서 이 모듈은 네트워크를 모른다(순수 함수).
 *
 * 🔴 새 의존성 0개 — 타임존 변환은 `fairy.js`가 이미 검증한 `Intl.DateTimeFormat` 기법을 재사용한다.
 * 🔴 국가·국민성으로 무엇도 추론하지 않는다 (Spec 필수 2 3순위 · 필수 9). 여기 쓰는 것은
 *    **타임존(IANA)과 업무시간 숫자**뿐이며, 사람에 대한 점수·등급을 만들지 않는다(G1/G2).
 */

import { getLocalParts, isWeekend } from '../schedule/fairy.js';

/** 기본 업무시간 — `fairy.js`의 오프타임 경계(09:00~18:00)와 같은 값으로 맞춘다. */
export const DEFAULT_WORK_START = 9;
export const DEFAULT_WORK_END = 18;

/** 추천을 훑어볼 기간(일). 너무 길면 "언제든 되네"가 되어 결정에 도움이 안 된다. */
export const LOOKAHEAD_DAYS = 5;

/**
 * 슬롯 등급.
 *   'comfortable' — 양쪽 다 업무시간 안. 제일 먼저 권한다.
 *   'i-yield'     — 나만 업무시간 밖(내가 양보). 포인트 보상 대상 (Spec §1 Token Economy).
 *   'they-yield'  — 상대만 업무시간 밖(상대가 양보). 보상 대상이 아니다.
 * 양쪽 다 밖인 시간은 애초에 후보로 만들지 않는다 — 아무에게도 좋지 않은 시간을 제안할 이유가 없다.
 */
export const SLOT_KINDS = {
  COMFORTABLE: 'comfortable',
  I_YIELD: 'i-yield',
  THEY_YIELD: 'they-yield',
};

/** Spec §1 — "회의 시간 양보 +50P". 내가 양보한 슬롯을 고른 경우에만 지급된다. */
export const YIELD_POINTS = 50;

function inWorkHours(hour, start, end) {
  return hour >= start && hour < end;
}

/**
 * 두 타임존의 겹치는 회의 시간 후보를 만든다.
 *
 * @param {object} input
 * @param {Date} [input.now] 기준 시각.
 * @param {string} input.myTimeZone 내 IANA 타임존.
 * @param {string} input.theirTimeZone 상대 IANA 타임존.
 * @param {number} [input.workStart] 업무 시작(시). 기본 9.
 * @param {number} [input.workEnd] 업무 종료(시). 기본 18.
 * @param {number} [input.days] 훑어볼 일수. 기본 5.
 * @param {number} [input.limit] 최대 후보 수. 기본 6.
 * @returns {{slots: Array, hasComfortable: boolean}}
 *   slot: {startUtcISO, mine:{hour,dateKey,weekday}, theirs:{...}, kind, yieldPoints}
 */
export function findMeetingSlots({
  now = new Date(),
  myTimeZone,
  theirTimeZone,
  workStart = DEFAULT_WORK_START,
  workEnd = DEFAULT_WORK_END,
  days = LOOKAHEAD_DAYS,
  limit = 6,
  /**
   * 🔴 **고른 요일만 본다** (2026-08-16 사용자 요청 ⑥). `null`이면 자동 — 평일 전부.
   *    기준은 **내 요일**이다: 사용자는 자기 달력을 보고 "화·목이 좋다"고 정하지, 상대 달력의
   *    요일로 생각하지 않는다. 13시간 차이가 나면 두 쪽 요일이 다를 수 있는데, 그때 상대 요일로
   *    거르면 사용자가 고른 적 없는 날이 나온다.
   * 🔴 빈 배열은 `null`과 같게 다룬다 — 요일을 전부 껐다고 "결과 없음"을 주면 고장으로 읽힌다.
   */
  weekdays = null,
}) {
  if (!myTimeZone || !theirTimeZone) return { slots: [], hasComfortable: false };
  const wanted = Array.isArray(weekdays) && weekdays.length > 0 ? new Set(weekdays) : null;

  const slots = [];
  // 정시 단위로만 훑는다 — 30분 단위까지 가면 후보가 두 배가 되는데 결정에 주는 정보는 거의 없다.
  const startMs = Math.ceil(now.getTime() / 3_600_000) * 3_600_000;

  for (let step = 0; step < days * 24; step += 1) {
    const instant = new Date(startMs + step * 3_600_000);
    const mine = getLocalParts(instant, myTimeZone);
    const theirs = getLocalParts(instant, theirTimeZone);

    // 🔴 어느 한쪽이라도 주말이면 제안하지 않는다. 주말 판정의 한계(토·일 고정)는
    //    `fairy.js` 헤더에 문서화된 것과 동일하다.
    if (isWeekend(mine.weekday) || isWeekend(theirs.weekday)) continue;
    if (wanted && !wanted.has(mine.weekday)) continue;

    const mineOk = inWorkHours(mine.hour, workStart, workEnd);
    const theirsOk = inWorkHours(theirs.hour, workStart, workEnd);
    if (!mineOk && !theirsOk) continue;

    let kind;
    if (mineOk && theirsOk) kind = SLOT_KINDS.COMFORTABLE;
    else if (!mineOk) kind = SLOT_KINDS.I_YIELD;
    else kind = SLOT_KINDS.THEY_YIELD;

    slots.push({
      startUtcISO: instant.toISOString(),
      mine: { hour: mine.hour, minute: mine.minute, dateKey: mine.dateKey, weekday: mine.weekday },
      theirs: { hour: theirs.hour, minute: theirs.minute, dateKey: theirs.dateKey, weekday: theirs.weekday },
      kind,
      yieldPoints: kind === SLOT_KINDS.I_YIELD ? YIELD_POINTS : 0,
    });
  }

  // 편한 시간 먼저, 그 안에서는 이른 시각 먼저. 편한 시간이 하나도 없을 때만 양보 슬롯이 위로 온다.
  const rank = { [SLOT_KINDS.COMFORTABLE]: 0, [SLOT_KINDS.THEY_YIELD]: 1, [SLOT_KINDS.I_YIELD]: 2 };
  slots.sort((a, b) => rank[a.kind] - rank[b.kind] || a.startUtcISO.localeCompare(b.startUtcISO));

  const hasComfortable = slots.some((slot) => slot.kind === SLOT_KINDS.COMFORTABLE);
  return { slots: selectBalanced(slots, limit, rank), hasComfortable };
}

/**
 * 상한만큼 고르되 **두 양보 방향이 모두 보이게** 채운다.
 *
 * 🔴 2026-08-13 실사용에서 드러난 결함: 서울↔뉴욕처럼 겹치는 시간이 아예 없으면 정렬 순서상
 *    `they-yield`가 상한(5개)을 전부 차지해 **`i-yield`가 한 칸도 안 보였다.** 그러면 화면에
 *    "내가 양보한다"는 선택지 자체가 없어서 양보 포인트(Spec §1)가 영영 발동하지 않는다 —
 *    이 기능의 존재 이유가 사라진다. 그래서 남는 자리를 두 방향에 **번갈아** 배분한다.
 *
 * 🔴 **2026-08-16 — 같은 결함이 화면에서 되살아나 있었다** (사용자 지적: "사용자만 편한 시간을
 *    한다"). 원인은 이 함수가 아니라 **호출부**였다: 카드가 `limit: 30`으로 뽑아 여기서
 *    15+15로 균형을 맞춘 뒤, 화면에서 다시 `.slice(0, 5)`로 잘랐다. 정렬은 등급 순이므로
 *    앞 5개는 **전부 `they-yield`** — 상대만 새벽인 시간 다섯 개가 나왔다.
 *    → 자르는 일은 반드시 **균형을 맞추는 쪽**이 해야 한다. 그래서 `balanceSlots()`를 내보내
 *    캘린더 필터 뒤에도 같은 규칙으로 자르게 했다.
 */
export function balanceSlots(sorted, limit) {
  const rank = { [SLOT_KINDS.COMFORTABLE]: 0, [SLOT_KINDS.THEY_YIELD]: 1, [SLOT_KINDS.I_YIELD]: 2 };
  return selectBalanced([...sorted].sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.startUtcISO.localeCompare(b.startUtcISO),
  ), limit, rank);
}

function selectBalanced(sorted, limit, rank) {
  const comfortable = sorted.filter((s) => s.kind === SLOT_KINDS.COMFORTABLE);
  // 편한 시간만으로 상한이 차면 굳이 양보를 권하지 않는다.
  if (comfortable.length >= limit) return comfortable.slice(0, limit);

  const theyYield = sorted.filter((s) => s.kind === SLOT_KINDS.THEY_YIELD);
  const iYield = sorted.filter((s) => s.kind === SLOT_KINDS.I_YIELD);

  const picked = [...comfortable];
  for (let i = 0; picked.length < limit && (i < theyYield.length || i < iYield.length); i += 1) {
    if (i < theyYield.length && picked.length < limit) picked.push(theyYield[i]);
    if (i < iYield.length && picked.length < limit) picked.push(iYield[i]);
  }

  // 표시 순서는 다시 등급·시각 순으로 — 번갈아 뽑은 순서 그대로 두면 목록이 뒤죽박죽 보인다.
  picked.sort((a, b) => rank[a.kind] - rank[b.kind] || a.startUtcISO.localeCompare(b.startUtcISO));
  return picked;
}
