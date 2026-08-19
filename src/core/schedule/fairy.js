/**
 * 퇴근 요정 — 비동기 예약 발송 계산 (S14 / Spec 필수 6).
 *
 * 순수 로직, 네트워크는 공휴일 조회(Nager.Date, 무료·키 불필요) 한 곳뿐이고 주입 가능하다.
 * LLM과 무관하다 — `src/core/refine|decode`와 인프라를 공유하지 않는다.
 *
 * 🔴 API 형태는 추측이 아니라 실측이다(2026-08-13, `date.nager.at`):
 *    `GET /api/v3/PublicHolidays/{year}/{countryCode}` → `[{ date: "YYYY-MM-DD", ... }]`.
 *    지원하지 않는 국가 코드는 404 + `{ title, status, detail }`.
 *
 * 🔴 타임존 계산은 새 의존성을 추가하지 않고 `Intl.DateTimeFormat`만으로 한다 — "지역 벽시계
 *    시각 → UTC 순간" 변환은 date-fns-tz 등이 쓰는 것과 같은 이중 보정 기법을 쓴다(아래
 *    `zonedWallTimeToUtc` 주석 참조). DST 전환 **그 순간**의 미세 오차는 감수한다(문서화된 한계).
 *
 * 🔴 "주말" 판정은 토·일 고정이다 — Spec 타겟 시장(한국·미국·일본·독일)이 전부 이 기준이라
 *    MVP로는 정확하지만, 금·토가 주말인 국가(중동 다수)에는 틀린다. 국가별 근무 요일까지
 *    확장하려면 이 상수를 국가 코드별 표로 바꾼다(지금은 하지 않는다 — 지어내지 않는다).
 */

const OFF_HOURS_START = 18; // 18:00
const OFF_HOURS_END = 9; // 09:00 (다음날 아침)
const WEEKEND_DAYS = new Set([0, 6]); // 일(0)·토(6) — 위 주석 참조

const NAGER_BASE_URL = 'https://date.nager.at/api/v3/PublicHolidays';

/** 상대가 지금 퇴근 시간대(18:00~09:00)인지. Spec 필수 6 원문 그대로. */
export function isOffHours(hour) {
  return hour >= OFF_HOURS_START || hour < OFF_HOURS_END;
}

export function isWeekend(weekday) {
  return WEEKEND_DAYS.has(weekday);
}

/**
 * 특정 시각을 특정 타임존의 벽시계 값으로 읽는다.
 * @returns {{year:number, month:number, day:number, hour:number, minute:number, weekday:number, dateKey:string}}
 *   weekday는 0=일 ~ 6=토(자바스크립트 Date#getDay와 동일 어휘).
 */
export function getLocalParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday],
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * "이 타임존에서 벽시계가 (y,m,d,hh,mm)을 가리키는 순간의 UTC 시각"을 구한다.
 *
 * 🔴 이중 보정 기법(date-fns-tz 등이 쓰는 표준 방법): ①UTC=벽시계값이라고 가정한 순간을 만들고
 *    ②그 순간이 실제로 타임존에서 몇 시로 읽히는지 확인해 ③그 차이만큼 되돌린다. DST 전환이
 *    "그 시각 근방 1시간 안"에서 일어나는 예외적 순간이 아니면 정확하다.
 */
function zonedWallTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const mappedBack = getLocalParts(new Date(guessUtcMs), timeZone);
  const mappedBackUtcMs = Date.UTC(mappedBack.year, mappedBack.month - 1, mappedBack.day, mappedBack.hour, mappedBack.minute);
  const driftMs = guessUtcMs - mappedBackUtcMs;
  return new Date(guessUtcMs + driftMs);
}

/**
 * 공휴일 조회. 실패(네트워크·미지원 국가)해도 던지지 않는다 — **알 수 없는 것을 "공휴일 아님"으로
 * 취급하고 진행한다**. 공휴일 확장 없이 주말 규칙만으로도 대부분 맞기 때문에, 조회 실패로 기능
 * 전체를 막지 않는다(단, 실패 사실은 반환값에 남긴다 — 조용히 삼키지 않는다).
 *
 * @returns {{holidays: Set<string>, ok: boolean}} holidays는 'YYYY-MM-DD' 문자열 집합.
 */
export async function fetchHolidays({ countryCode, year, fetchImpl = fetch, timeoutMs = 5000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${NAGER_BASE_URL}/${year}/${countryCode}`, { signal: controller.signal });
    if (!res.ok) return { holidays: new Set(), ok: false };
    const list = await res.json();
    if (!Array.isArray(list)) return { holidays: new Set(), ok: false };
    return { holidays: new Set(list.map((item) => item.date)), ok: true };
  } catch {
    return { holidays: new Set(), ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 다음 발송 시각을 계산한다 — Spec 필수 6 전체(퇴근시간·공휴일·주말 연장, 아침 9시 목표).
 *
 * @param {object} input
 * @param {Date} input.now
 * @param {string} input.timeZone 상대 타임존(IANA, 예: 'Europe/Berlin').
 * @param {string} [input.countryCode] 상대 국가 코드(Nager.Date 형식, 예: 'DE'). 없으면 공휴일 확장을 건너뛴다.
 * @param {number} [input.workStartHour] 기본 9 — 업무시간 학습값 반영은 S13 이후(지금은 고정값, 문서화된 한계).
 * @param {typeof fetch} [input.fetchImpl]
 *
 * @returns {Promise<{
 *   needsSchedule: boolean,
 *   reason: 'off-hours'|'weekend'|'holiday'|null,
 *   sendAt: Date|null,
 *   localParts: object|null,
 *   holidayLookupFailed: boolean,
 * }>}
 */
export async function computeNextSendTime({
  now = new Date(),
  timeZone,
  countryCode = null,
  workStartHour = OFF_HOURS_END,
  fetchImpl = fetch,
}) {
  const nowLocal = getLocalParts(now, timeZone);

  let holidays = new Set();
  let holidayLookupFailed = false;
  if (countryCode) {
    // 연말 자정 근처 케이스까지 커버하려고 올해·내년 둘 다 받는다.
    const [thisYear, nextYear] = await Promise.all([
      fetchHolidays({ countryCode, year: nowLocal.year, fetchImpl }),
      fetchHolidays({ countryCode, year: nowLocal.year + 1, fetchImpl }),
    ]);
    holidays = new Set([...thisYear.holidays, ...nextYear.holidays]);
    holidayLookupFailed = !thisYear.ok || !nextYear.ok;
  }

  const todayIsHoliday = holidays.has(nowLocal.dateKey);
  const nowOffHours = isOffHours(nowLocal.hour);
  const nowIsNonBusinessDay = isWeekend(nowLocal.weekday) || todayIsHoliday;

  if (!nowOffHours && !nowIsNonBusinessDay) {
    return { needsSchedule: false, reason: null, sendAt: null, localParts: nowLocal, holidayLookupFailed };
  }

  const reason = todayIsHoliday || isWeekend(nowLocal.weekday) ? (todayIsHoliday ? 'holiday' : 'weekend') : 'off-hours';

  // 새벽(00:00~09:00)이고 오늘이 영업일이면 "오늘 9시" — Spec "새벽일 경우 현지 아침 9시".
  // 그 외(저녁 이후, 또는 오늘이 주말/공휴일)에는 내일부터 다음 영업일을 찾는다.
  let cursor = new Date(Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day));
  const todayQualifiesForSameDay = nowLocal.hour < workStartHour && !nowIsNonBusinessDay;
  if (!todayQualifiesForSameDay) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  // 공휴일·주말이 연속되는 극단적 케이스에서도 멈추도록 상한을 둔다(비정상 데이터 방어).
  for (let guard = 0; guard < 30; guard += 1) {
    const parts = getLocalParts(cursor, timeZone);
    if (!isWeekend(parts.weekday) && !holidays.has(parts.dateKey)) {
      const sendAt = zonedWallTimeToUtc(parts.year, parts.month, parts.day, workStartHour, 0, timeZone);
      return { needsSchedule: true, reason, sendAt, localParts: getLocalParts(sendAt, timeZone), holidayLookupFailed };
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  // 30일 연속 비영업일은 실질적으로 데이터 이상이다 — 지어낸 날짜를 주지 않고 실패를 알린다.
  return { needsSchedule: true, reason, sendAt: null, localParts: null, holidayLookupFailed: true };
}
