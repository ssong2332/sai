/**
 * 퇴근 요정 단위 테스트 (S14 / Spec 필수 6). 날짜·요일은 추측하지 않고 실제 계산/실제 API
 * 응답으로 확정했다(2026-08-13, `Intl.DateTimeFormat` 및 `date.nager.at` 실측).
 *
 * 🔴 2026-08-17(월)은 **실제 한국 공휴일**(광복절) — 8/15(토)·8/16(일) 주말에 바로 이어져
 *    "주말+공휴일 연속 연장"을 인위적 픽스처 없이 실데이터로 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isOffHours,
  isWeekend,
  getLocalParts,
  computeNextSendTime,
  fetchHolidays,
} from '../src/core/schedule/fairy.js';

/** 2026년 KR 공휴일 실측 부분집합(date.nager.at, 2026-08-13 조회) — 지어낸 값이 아니다. */
const KR_2026_HOLIDAYS = [
  { date: '2026-08-17' }, // 광복절 (월) — 8/15(토)·8/16(일) 주말 바로 다음날
  { date: '2026-01-01' },
];

function stubHolidayFetch({ okYears = ['2026'] } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const year = url.match(/PublicHolidays\/(\d{4})\//)[1];
    if (!okYears.includes(year)) return { ok: false };
    const body = year === '2026' ? KR_2026_HOLIDAYS : [];
    return { ok: true, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

/* ── isOffHours / isWeekend 경계값 ────────────────────────────────────── */

test('isOffHours: 18시부터 다음날 9시 전까지가 퇴근시간이다 (Spec 필수 6 원문)', () => {
  assert.equal(isOffHours(18), true);
  assert.equal(isOffHours(17), false);
  assert.equal(isOffHours(23), true);
  assert.equal(isOffHours(0), true);
  assert.equal(isOffHours(8), true);
  assert.equal(isOffHours(9), false); // 경계 — 9시 정각은 업무시간
});

test('isWeekend: 토·일만 주말이다', () => {
  assert.equal(isWeekend(0), true);
  assert.equal(isWeekend(6), true);
  assert.equal(isWeekend(1), false);
  assert.equal(isWeekend(5), false);
});

/* ── getLocalParts — 타임존 변환 정확성 (DST 지역 포함) ─────────────── */

test('getLocalParts: Asia/Seoul(UTC+9, DST 없음)은 단순 덧셈과 일치한다', () => {
  const parts = getLocalParts(new Date('2026-08-13T05:00:00Z'), 'Asia/Seoul');
  assert.deepEqual(
    { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, weekday: parts.weekday },
    { year: 2026, month: 8, day: 13, hour: 14, weekday: 4 }, // 목요일
  );
});

test('getLocalParts: Europe/Berlin(여름 CEST, UTC+2) 오프셋이 실제로 반영된다', () => {
  const parts = getLocalParts(new Date('2026-08-13T16:00:00Z'), 'Europe/Berlin');
  assert.equal(parts.hour, 18); // 16:00 UTC + 2 = 18:00 CEST
});

/* ── computeNextSendTime — 판정표 8행 ──────────────────────────────── */

test('업무시간 중(평일, 공휴일 아님)이면 예약이 필요 없다', async () => {
  const result = await computeNextSendTime({
    now: new Date('2026-08-13T05:00:00Z'), // 목 14:00 KST
    timeZone: 'Asia/Seoul',
  });
  assert.equal(result.needsSchedule, false);
  assert.equal(result.reason, null);
  assert.equal(result.sendAt, null);
});

test('저녁 퇴근시간(평일 19시)이면 다음날 아침 9시로 예약한다', async () => {
  const result = await computeNextSendTime({
    now: new Date('2026-08-13T10:00:00Z'), // 목 19:00 KST
    timeZone: 'Asia/Seoul',
  });
  assert.equal(result.needsSchedule, true);
  assert.equal(result.reason, 'off-hours');
  const sendAtLocal = getLocalParts(result.sendAt, 'Asia/Seoul');
  assert.deepEqual(
    { month: sendAtLocal.month, day: sendAtLocal.day, hour: sendAtLocal.hour, minute: sendAtLocal.minute },
    { month: 8, day: 14, hour: 9, minute: 0 }, // 금요일 09:00
  );
});

test('새벽(평일 08:30)이면 "오늘" 아침 9시로 예약한다 (Spec "새벽일 경우" 원문)', async () => {
  const result = await computeNextSendTime({
    now: new Date('2026-08-13T23:30:00Z'), // 금 08:30 KST (2026-08-14)
    timeZone: 'Asia/Seoul',
  });
  assert.equal(result.needsSchedule, true);
  assert.equal(result.reason, 'off-hours');
  const sendAtLocal = getLocalParts(result.sendAt, 'Asia/Seoul');
  assert.deepEqual(
    { day: sendAtLocal.day, hour: sendAtLocal.hour },
    { day: 14, hour: 9 }, // 같은 날(14일) 09:00 — 다음날로 밀리지 않는다
  );
});

test('주말 + 곧바로 이어지는 실제 공휴일(2026-08-17 광복절)을 연속으로 건너뛴다', async () => {
  // 2026-08-15(토) 11:00 KST — 토·일 지나면 월요일인데, 그 월요일이 실제 광복절이다.
  const result = await computeNextSendTime({
    now: new Date('2026-08-15T02:00:00Z'),
    timeZone: 'Asia/Seoul',
    countryCode: 'KR',
    fetchImpl: stubHolidayFetch(),
  });
  assert.equal(result.needsSchedule, true);
  assert.equal(result.reason, 'weekend'); // 지금(토)의 사유
  const sendAtLocal = getLocalParts(result.sendAt, 'Asia/Seoul');
  assert.deepEqual(
    { month: sendAtLocal.month, day: sendAtLocal.day, hour: sendAtLocal.hour },
    { month: 8, day: 18, hour: 9 }, // 화요일(18일) — 토·일·월(공휴일) 전부 건너뜀
  );
});

test('평일이지만 공휴일이면(2026-08-17, 업무시간 중이라도) 다음 영업일로 강제 연장한다', async () => {
  const result = await computeNextSendTime({
    now: new Date('2026-08-17T02:00:00Z'), // 월 11:00 KST — 시간만 보면 업무시간
    timeZone: 'Asia/Seoul',
    countryCode: 'KR',
    fetchImpl: stubHolidayFetch(),
  });
  assert.equal(result.needsSchedule, true);
  assert.equal(result.reason, 'holiday');
  const sendAtLocal = getLocalParts(result.sendAt, 'Asia/Seoul');
  assert.deepEqual({ day: sendAtLocal.day, hour: sendAtLocal.hour }, { day: 18, hour: 9 });
});

test('공휴일 조회가 실패해도 던지지 않고, 주말 규칙만으로 계속 진행한다', async () => {
  const failingFetch = async () => ({ ok: false });
  const result = await computeNextSendTime({
    now: new Date('2026-08-15T02:00:00Z'), // 토 11:00 KST
    timeZone: 'Asia/Seoul',
    countryCode: 'KR',
    fetchImpl: failingFetch,
  });
  assert.equal(result.holidayLookupFailed, true);
  assert.equal(result.needsSchedule, true);
  // 공휴일을 모르므로 월요일(17일)에서 멈춘다 — 그날이 실제로는 공휴일이라는 걸 반영 못 하는
  // 것이 이 폴백의 알려진 한계다(조용히 숨기지 않고 holidayLookupFailed로 알린다).
  const sendAtLocal = getLocalParts(result.sendAt, 'Asia/Seoul');
  assert.equal(sendAtLocal.day, 17);
});

test('countryCode를 안 주면 공휴일 조회 자체를 하지 않는다', async () => {
  const spy = stubHolidayFetch();
  const result = await computeNextSendTime({
    now: new Date('2026-08-15T02:00:00Z'), // 토
    timeZone: 'Asia/Seoul',
    fetchImpl: spy,
  });
  assert.equal(spy.calls.length, 0);
  assert.equal(result.holidayLookupFailed, false);
  const sendAtLocal = getLocalParts(result.sendAt, 'Asia/Seoul');
  assert.equal(sendAtLocal.day, 17); // 공휴일 정보 없이 월요일에서 멈춤(정직한 한계)
});

/* ── fetchHolidays — API 실패 형태 대응 ───────────────────────────────── */

test('fetchHolidays: 404·비정상 응답이면 빈 집합과 ok:false를 돌려준다', async () => {
  const notFound = async () => ({ ok: false, status: 404 });
  const { holidays, ok } = await fetchHolidays({ countryCode: 'ZZ', year: 2026, fetchImpl: notFound });
  assert.equal(ok, false);
  assert.equal(holidays.size, 0);
});

test('fetchHolidays: 정상 응답의 date 필드만 집합으로 뽑는다', async () => {
  const ok200 = async () => ({ ok: true, json: async () => KR_2026_HOLIDAYS });
  const { holidays, ok } = await fetchHolidays({ countryCode: 'KR', year: 2026, fetchImpl: ok200 });
  assert.equal(ok, true);
  assert.ok(holidays.has('2026-08-17'));
});
