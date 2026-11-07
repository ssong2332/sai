/**
 * 예약 시각 전수 점검 (2026-11-07 전수 점검 — 스크래치패드 300건 대조를 반복 가능한 테스트로 옮김).
 *
 * 🔴 **독립 오라클과 대조한다.** `computeNextSendTime`의 구현(달력 커서·UTC 보정)을 쓰지 않고,
 *    지금 시각부터 15분 격자를 걸어 「현지 09:00 · 월~금 · 공휴일 아님」인 첫 순간을 찾는다.
 *    15분 격자는 +5:45(네팔)·-3:30(뉴펀들랜드) 같은 시간대의 09:00도 빠짐없이 지난다.
 * 🔴 **네트워크 없음.** 공휴일은 `test/fixtures/holidays-2026-2028.json` — date.nager.at 실제 응답에서 날짜만
 *    뽑아 둔 것이다(지어낸 값이 아니다). `null`인 국가(IN·NP·AE)는 API가 데이터를 주지 않는 곳(204)이다.
 * 🔴 **언어는 입력이 아니다.** 예약 계산은 받는 사람의 시간대·국가만 본다(`SaiOverlay.jsx` `runSchedule`) —
 *    그래서 이 표가 7개 언어(ko·en·ja·zh·de·fr·es) 모두에 그대로 적용된다. 언어별 화면은 e2e로 따로 확인했다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeNextSendTime, getLocalParts } from '../src/core/schedule/fairy.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/holidays-2026-2028.json', import.meta.url), 'utf8'));

function fixtureFetch(url) {
  const m = /PublicHolidays\/(\d{4})\/([A-Z]{2})$/.exec(url);
  const dates = m ? FIXTURE.countries[`${m[1]}/${m[2]}`] : undefined;
  if (!dates) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  return Promise.resolve({ ok: true, status: 200, json: async () => dates.map((date) => ({ date })) });
}

const ZONES = [
  ['Asia/Seoul', 'KR'], ['Asia/Tokyo', 'JP'], ['Asia/Shanghai', 'CN'], ['Asia/Kolkata', 'IN'], ['Asia/Kathmandu', 'NP'],
  ['Asia/Singapore', 'SG'], ['Australia/Sydney', 'AU'], ['Pacific/Auckland', 'NZ'], ['Europe/London', 'GB'], ['Europe/Berlin', 'DE'],
  ['Europe/Paris', 'FR'], ['Europe/Madrid', 'ES'], ['America/New_York', 'US'], ['America/Los_Angeles', 'US'], ['America/Sao_Paulo', 'BR'],
  ['America/St_Johns', 'CA'], ['Pacific/Honolulu', 'US'], ['America/Mexico_City', 'MX'], ['Asia/Ho_Chi_Minh', 'VN'], ['Asia/Dubai', 'AE'],
];

/** 상황 — 평일 낮·밤·새벽 · 금요일 저녁 · 토·일 · 성탄·연말·설 · 미국·EU 서머타임 시작 주말 · 미국·EU 서머타임 끝 주말 · 노동절. */
const NOWS = [
  '2026-11-04T03:00:00Z', '2026-11-04T13:30:00Z', '2026-11-04T21:10:00Z', '2026-11-06T10:00:00Z', '2026-11-06T23:59:00Z',
  '2026-11-07T04:18:00Z', '2026-11-08T12:00:00Z', '2026-12-24T10:00:00Z', '2026-12-31T12:00:00Z', '2027-02-05T10:00:00Z',
  '2026-03-07T15:00:00Z', '2026-03-28T12:00:00Z', '2026-10-03T12:00:00Z', '2026-10-24T12:00:00Z', '2026-05-01T02:00:00Z',
];

const STEP_MS = 15 * 60 * 1000;

function holidaysFor(cc, year) {
  return new Set([...(FIXTURE.countries[`${year}/${cc}`] ?? []), ...(FIXTURE.countries[`${year + 1}/${cc}`] ?? [])]);
}

/** 독립 오라클 — 지금이 현지 업무시간이면 null(예약 불필요), 아니면 다음 「현지 09:00 영업일」 순간. */
function oracle(now, timeZone, cc) {
  const holidays = holidaysFor(cc, getLocalParts(now, timeZone).year);
  const isBusinessDay = (p) => p.weekday >= 1 && p.weekday <= 5 && !holidays.has(p.dateKey);
  const local = getLocalParts(now, timeZone);
  if (isBusinessDay(local) && local.hour >= 9 && local.hour < 18) return null;
  for (let t = Math.ceil(now.getTime() / STEP_MS) * STEP_MS, i = 0; i < 4 * 24 * 31; i += 1, t += STEP_MS) {
    const p = getLocalParts(new Date(t), timeZone);
    if (p.hour === 9 && p.minute === 0 && isBusinessDay(p)) return new Date(t).toISOString();
  }
  return 'none-within-31-days';
}

test(`🔴 예약 시각 전수 점검 — 시간대 ${ZONES.length}곳 × 상황 ${NOWS.length}가지를 독립 오라클과 대조`, async () => {
  const failures = [];
  let scheduled = 0;
  for (const [timeZone, cc] of ZONES) {
    for (const iso of NOWS) {
      const now = new Date(iso);
      const r = await computeNextSendTime({ now, timeZone, countryCode: cc, fetchImpl: fixtureFetch });
      const expected = oracle(now, timeZone, cc);
      const got = r.needsSchedule ? (r.sendAt ? r.sendAt.toISOString() : 'null') : null;
      if (got !== expected) failures.push(`${timeZone} @ ${iso}: got ${got}, expected ${expected}`);
      if (got) scheduled += 1;
      // 공휴일 데이터가 없는 국가만 「공휴일 조회 실패」로 표시된다 — 화면 배너 문구의 근거(K11).
      const noData = FIXTURE.countries[`${getLocalParts(now, timeZone).year}/${cc}`] === null;
      if (r.holidayLookupFailed !== noData) failures.push(`${timeZone} @ ${iso}: holidayLookupFailed=${r.holidayLookupFailed}, expected ${noData}`);
    }
  }
  assert.deepEqual(failures, []);
  // 점검이 한쪽으로 쏠리지 않았는지 — 예약이 필요한 경우와 필요 없는 경우가 둘 다 충분히 섞여 있다.
  assert.ok(scheduled >= 200 && scheduled <= 260, `예약 필요 ${scheduled}건`);
});

test('예약 시각은 언제나 미래이고, 현지 월~금 09:00이다 (전수 점검의 불변식)', async () => {
  for (const [timeZone, cc] of ZONES) {
    for (const iso of NOWS) {
      const now = new Date(iso);
      const r = await computeNextSendTime({ now, timeZone, countryCode: cc, fetchImpl: fixtureFetch });
      if (!r.needsSchedule) continue;
      assert.ok(r.sendAt > now, `${timeZone} @ ${iso}: 과거 시각`);
      const p = getLocalParts(r.sendAt, timeZone);
      assert.equal(`${p.hour}:${p.minute}`, '9:0', `${timeZone} @ ${iso}`);
      assert.ok(p.weekday >= 1 && p.weekday <= 5, `${timeZone} @ ${iso}: 주말`);
    }
  }
});
