/**
 * 소개 사이트 「보낼 때」 장면의 시계 — 방문자의 지금 시각으로 그린다 (2026-10-31 사용자 결정 「이대로 진행」).
 *
 * 이 장면은 예약 기능(상대의 오전 9시에 다시 알림)을 보여 준다. 그래서 상대 도시는 **지금 퇴근 뒤인 곳**으로 고른다.
 *
 * | 순서 | 조건 | 결과 |
 * |---|---|---|
 * | ① | `PARTNER_CITIES`를 차례로 보며, 그 도시가 지금 19:00~07:00이고 방문자와 **3시간** 이상 차이 나는 첫 도시(2026-11-01 4→3시간 — 서울 밤 11시~새벽 3시 예외 없앰) | 그 도시, `mode:'schedule'` |
 * | ② | 그런 도시가 없음(방문자 자신이 한밤중) | 샌프란시스코, `mode:'now'`(「한창 일하는 중」) |
 * | ③ | 브라우저가 시간대를 못 줌 | `null` — 화면은 고정 예시(서울 19:35 · 샌프란시스코 03:35) |
 *
 * 🔴 시간대는 화면 계산에만 쓴다 — 어디에도 보내거나 저장하지 않는다.
 */

/** 상대 도시 후보 — 이 순서로 본다. */
export const PARTNER_CITIES = Object.freeze([
  { timeZone: 'America/Los_Angeles', city: '샌프란시스코' },
  { timeZone: 'America/New_York', city: '뉴욕' },
  { timeZone: 'Europe/London', city: '런던' },
  { timeZone: 'Europe/Berlin', city: '베를린' },
  { timeZone: 'Asia/Singapore', city: '싱가포르' },
  { timeZone: 'Australia/Sydney', city: '시드니' },
  { timeZone: 'Asia/Kolkata', city: '벵갈루루' },
]);

/** 방문자 도시 이름 — 표에 없으면 「내 시간」. */
const MY_CITY = {
  'Asia/Seoul': '서울',
  'Asia/Tokyo': '도쿄',
  'Asia/Shanghai': '상하이',
  'Asia/Hong_Kong': '홍콩',
  'Asia/Taipei': '타이베이',
  'Asia/Ho_Chi_Minh': '호찌민',
  'Asia/Bangkok': '방콕',
  'Europe/Paris': '파리',
  'America/Chicago': '시카고',
  'America/Toronto': '토론토',
  ...Object.fromEntries(PARTNER_CITIES.map((c) => [c.timeZone, c.city])),
};

const DAY = 24 * 60;
const AFTER_WORK_START = 19 * 60;
const AFTER_WORK_END = 7 * 60;
const MIN_GAP = 3 * 60;
const SEND_AT = 9 * 60;

/** `timeZone`에서 본 지금 — 하루 중 분, UTC와의 차(분). 모르는 시간대면 던진다. */
export function zoned(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  const minutes = parts.hour * 60 + parts.minute;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const floored = Math.floor(date.getTime() / 60000) * 60000;
  return { minutes, offset: Math.round((asUtc - floored) / 60000) };
}

/** 「19:35」 */
export function hhmm(minutes) {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 「새벽 1:00」·「오전 9:00」 */
export function koClock(minutes) {
  const m = ((minutes % DAY) + DAY) % DAY;
  const h = Math.floor(m / 60);
  const period = h < 6 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : '저녁';
  return `${period} ${h % 12 || 12}:${String(m % 60).padStart(2, '0')}`;
}

/** 시계 아래 상태 이름. */
export function stateLabel(minutes) {
  const h = Math.floor((((minutes % DAY) + DAY) % DAY) / 60);
  if (h < 6 || h >= 22) return '자는 시간';
  if (h < 9) return '아침';
  if (h < 12) return '오전';
  if (h < 18) return '오후';
  return '저녁';
}

/** 「16시간」·「3시간 30분」 */
export function gapLabel(minutes) {
  const m = Math.abs(minutes);
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

const afterWork = (m) => m >= AFTER_WORK_START || m < AFTER_WORK_END;

/**
 * 위 판정표. `now`·`myTimeZone`을 받아 장면 하나를 돌려준다(③이면 null).
 * @returns {null | {mode: 'schedule'|'now', gap: string,
 *   me: {city: string, time: string, minutes: number, state: string},
 *   them: {city: string, time: string, minutes: number, state: string},
 *   send: {minutes: number, theirLabel: string, myLabel: string}}}
 */
export function pickScene(now, myTimeZone) {
  let mine;
  try {
    if (!myTimeZone) return null;
    mine = zoned(now, myTimeZone);
  } catch {
    return null;
  }
  const side = (z, city) => ({ city, time: hhmm(z.minutes), minutes: z.minutes, state: stateLabel(z.minutes) });
  const me = side(mine, MY_CITY[myTimeZone] ?? '내 시간');

  for (const c of PARTNER_CITIES) {
    const z = zoned(now, c.timeZone);
    if (Math.abs(z.offset - mine.offset) < MIN_GAP || !afterWork(z.minutes)) continue;
    const sendMine = SEND_AT - z.offset + mine.offset;
    return {
      mode: 'schedule',
      gap: gapLabel(z.offset - mine.offset),
      me,
      them: side(z, c.city),
      send: { minutes: SEND_AT, theirLabel: koClock(SEND_AT), myLabel: `${me.city} ${koClock(sendMine)}` },
    };
  }

  const fallback = PARTNER_CITIES[0];
  const z = zoned(now, fallback.timeZone);
  return {
    mode: 'now',
    gap: gapLabel(z.offset - mine.offset),
    me,
    them: side(z, fallback.city),
    send: { minutes: z.minutes, theirLabel: koClock(z.minutes), myLabel: `${me.city} ${koClock(mine.minutes)}` },
  };
}

/** 다음 분 경계(:00초)까지 남은 ms — 시계가 분이 바뀌는 그 순간에 바뀌게(2026-10-31). 0이 되지 않게 최소 1ms. */
export function msToNextMinute(nowMs) {
  return 60_000 - (((nowMs % 60_000) + 60_000) % 60_000) || 60_000;
}

/** 하루 띠 위 위치(%). */
export function bandPercent(minutes) {
  return `${((((minutes % DAY) + DAY) % DAY) / DAY) * 100}%`;
}
