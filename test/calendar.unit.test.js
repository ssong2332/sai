/**
 * S23 — 캘린더 빈 시간 필터·조회 단위 테스트 (Spec 권장 12 · 필수 5).
 *
 * 🔴 이 테스트가 지키려는 핵심:
 *    ① **"확인 안 함"과 "확인했는데 안 바쁨"을 절대 섞지 않는다** — 섞이면 화면이 거짓말한다.
 *    ② **경계는 겹치지 않는다** — 10시에 끝나는 회의와 10시 시작은 연달아 가능하다.
 *    ③ **일정 제목이 들어올 자리가 없다** — FreeBusy 응답에서 시각 외 필드를 버린다.
 *    ④ 응답이 이상하면 **빈 배열이 아니라 오류**다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  excludeBusySlots,
  busyNotice,
  DEFAULT_MEETING_MINUTES,
} from '../src/core/meeting/freebusy.js';
import {
  fetchBusyIntervals,
  isCalendarLinked,
  calendarErrorMessage,
  CALENDAR_ERRORS,
} from '../src/lib/calendarClient.js';

const slot = (iso) => ({ startUtcISO: iso });

function fakeFetch(result) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: result.status === undefined || (result.status >= 200 && result.status < 300),
      status: result.status ?? 200,
      json: async () => result.body,
    };
  };
  impl.calls = calls;
  return impl;
}

/** chrome.identity 흉내. */
function fakeIdentity(token) {
  return {
    getAuthToken: (_options, cb) => cb(token),
    removeCachedAuthToken: (_options, cb) => cb(),
  };
}

/* ── "확인 안 함"과 "안 바쁨"은 다르다 ─────────────────────────────── */

test('🔴 busy가 null이면 checked=false — 아무것도 안 뺐다는 뜻이지 "안 바쁘다"가 아니다', () => {
  const slots = [slot('2026-08-20T01:00:00Z'), slot('2026-08-20T02:00:00Z')];
  const result = excludeBusySlots(slots, null);
  assert.equal(result.checked, false);
  assert.equal(result.removed, 0);
  assert.equal(result.slots.length, 2);
  assert.match(busyNotice(result), /확인하지 않았어요/);
});

test('🔴 busy가 빈 배열이면 checked=true, removed=0 — 확인했고 안 바쁜 것', () => {
  const result = excludeBusySlots([slot('2026-08-20T01:00:00Z')], []);
  assert.equal(result.checked, true);
  assert.equal(result.removed, 0);
  assert.match(busyNotice(result), /겹치는 일정은 없었어요/);
});

test('🔴 어떤 안내 문구도 "상대가 비어 있다"고 말하지 않는다', () => {
  for (const result of [
    { checked: false, removed: 0 },
    { checked: true, removed: 0 },
    { checked: true, removed: 3 },
  ]) {
    const notice = busyNotice(result);
    assert.ok(!/상대.*(비어|한가|가능)/.test(notice), `문구가 상대 일정을 단정한다: ${notice}`);
  }
});

/* ── 겹침 판정 ─────────────────────────────────────────────────────── */

test('바쁜 시간과 겹치는 슬롯만 빠진다', () => {
  const slots = [
    slot('2026-08-20T01:00:00Z'), // 겹침
    slot('2026-08-20T05:00:00Z'), // 안 겹침
  ];
  const busy = [{ start: '2026-08-20T00:30:00Z', end: '2026-08-20T01:30:00Z' }];
  const result = excludeBusySlots(slots, busy);
  assert.equal(result.removed, 1);
  assert.deepEqual(result.slots.map((s) => s.startUtcISO), ['2026-08-20T05:00:00Z']);
});

test('🔴 경계는 겹치지 않는다 — 10시에 끝나는 일정과 10시 시작은 연달아 가능하다', () => {
  const busy = [{ start: '2026-08-20T09:00:00Z', end: '2026-08-20T10:00:00Z' }];
  // 10:00 시작 → 겹치지 않아야 한다.
  assert.equal(excludeBusySlots([slot('2026-08-20T10:00:00Z')], busy).removed, 0);
  // 08:00 시작 + 60분 = 09:00 종료 → 역시 겹치지 않아야 한다.
  assert.equal(excludeBusySlots([slot('2026-08-20T08:00:00Z')], busy).removed, 0);
  // 09:30 시작 → 겹친다.
  assert.equal(excludeBusySlots([slot('2026-08-20T09:30:00Z')], busy).removed, 1);
});

test('회의 길이를 늘리면 더 많이 걸린다', () => {
  const busy = [{ start: '2026-08-20T11:00:00Z', end: '2026-08-20T12:00:00Z' }];
  const slots = [slot('2026-08-20T10:00:00Z')];
  assert.equal(excludeBusySlots(slots, busy, { meetingMinutes: 60 }).removed, 0);
  assert.equal(excludeBusySlots(slots, busy, { meetingMinutes: 90 }).removed, 1);
  assert.equal(DEFAULT_MEETING_MINUTES, 60);
});

test('🔴 깨진 구간은 버린다 — 0으로 읽으면 엉뚱한 슬롯이 지워진다', () => {
  const busy = [
    { start: 'not-a-date', end: '2026-08-20T01:30:00Z' },
    { start: '2026-08-20T02:00:00Z', end: '2026-08-20T01:00:00Z' }, // 끝이 시작보다 앞
  ];
  const result = excludeBusySlots([slot('2026-08-20T01:00:00Z')], busy);
  assert.equal(result.removed, 0);
  assert.equal(result.checked, true);
});

test('읽을 수 없는 슬롯은 함부로 지우지 않는다', () => {
  const busy = [{ start: '2026-08-20T00:00:00Z', end: '2026-08-21T00:00:00Z' }];
  const result = excludeBusySlots([{ startUtcISO: 'garbage' }], busy);
  assert.equal(result.removed, 0);
});

/* ── 조회 ───────────────────────────────────────────────────────────── */

test('🔴 FreeBusy만 부르고 events.list를 부르지 않는다 (제목을 받지 않는다)', async () => {
  const impl = fakeFetch({ body: { calendars: { primary: { busy: [] } } } });
  await fetchBusyIntervals({
    timeMin: new Date('2026-08-20T00:00:00Z'),
    timeMax: new Date('2026-08-25T00:00:00Z'),
    fetchImpl: impl,
    identityImpl: fakeIdentity('tok'),
  });
  assert.match(impl.calls[0].url, /freeBusy$/);
  assert.ok(!/events/.test(impl.calls[0].url));
  const sent = JSON.parse(impl.calls[0].init.body);
  assert.deepEqual(sent.items, [{ id: 'primary' }], '내 캘린더 외를 묻고 있다');
});

test('🔴 응답에서 시각 외 필드는 버린다 — 제목이 흘러들 자리를 없앤다', async () => {
  const impl = fakeFetch({
    body: {
      calendars: {
        primary: {
          busy: [
            {
              start: '2026-08-20T01:00:00Z',
              end: '2026-08-20T02:00:00Z',
              summary: '비밀 회의 제목',
              attendees: ['someone@example.com'],
            },
          ],
        },
      },
    },
  });
  const busy = await fetchBusyIntervals({
    timeMin: new Date(),
    timeMax: new Date(),
    fetchImpl: impl,
    identityImpl: fakeIdentity('tok'),
  });
  assert.deepEqual(Object.keys(busy[0]).sort(), ['end', 'start']);
  assert.ok(!JSON.stringify(busy).includes('비밀 회의 제목'));
});

test('🔴 응답이 예상과 다르면 빈 배열이 아니라 오류다', async () => {
  const impl = fakeFetch({ body: { calendars: {} } });
  await assert.rejects(
    () =>
      fetchBusyIntervals({
        timeMin: new Date(),
        timeMax: new Date(),
        fetchImpl: impl,
        identityImpl: fakeIdentity('tok'),
      }),
    (error) => error.reason === CALENDAR_ERRORS.UNKNOWN,
  );
});

test('401/403은 거부로, 네트워크 실패는 네트워크로 구분한다', async () => {
  const denied = fakeFetch({ status: 403, body: {} });
  await assert.rejects(
    () =>
      fetchBusyIntervals({
        timeMin: new Date(),
        timeMax: new Date(),
        fetchImpl: denied,
        identityImpl: fakeIdentity('tok'),
      }),
    (e) => e.reason === CALENDAR_ERRORS.DENIED,
  );

  const dead = async () => {
    throw new Error('offline');
  };
  await assert.rejects(
    () =>
      fetchBusyIntervals({
        timeMin: new Date(),
        timeMax: new Date(),
        fetchImpl: dead,
        identityImpl: fakeIdentity('tok'),
      }),
    (e) => e.reason === CALENDAR_ERRORS.NETWORK,
  );
});

test('토큰이 없으면 연결 안 됨으로 본다 — 동의 창을 띄우지 않는다', async () => {
  assert.equal(await isCalendarLinked({ identityImpl: fakeIdentity(null) }), false);
  assert.equal(await isCalendarLinked({ identityImpl: fakeIdentity('tok') }), true);
});

test('모든 실패 사유에 사람이 읽을 문구가 있다', () => {
  for (const reason of Object.values(CALENDAR_ERRORS)) {
    const message = calendarErrorMessage(reason);
    assert.ok(message.length > 0, `${reason}에 문구가 없다`);
    assert.ok(!message.includes('undefined'));
  }
});

/**
 * 🔴 **조용한 확인은 조용해야 한다** (2026-08-20 테스터 제보).
 *
 *    사이드패널은 열릴 때마다 `interactive: false`로 캘린더 연결 여부를 확인한다.
 *    캘린더를 연결한 적 없는 사람에게는 **실패가 정상 상태**인데, 그때마다 `console.warn`을
 *    찍으면 `chrome://extensions`의 「오류」 목록에 빨갛게 쌓여 **테스터가 설치 실패로 읽는다.**
 *    실제로 그 보고를 받았다.
 * 🔴 반대로 버튼을 눌러 시도한 경우(`interactive: true`)에는 남겨야 한다 — 사용자가 되기를
 *    기대한 동작이라 진단이 필요하다.
 */
test('🔴 조용한 연결 확인(interactive:false)은 콘솔에 경고를 남기지 않는다', async () => {
  const { isCalendarLinked } = await import('../src/lib/calendarClient.js');
  const identityImpl = { getAuthToken: (_opts, cb) => cb(undefined) }; // 토큰 없음 = 미연결

  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args);
  try {
    assert.equal(await isCalendarLinked({ identityImpl }), false);
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(warned, [], `조용한 확인이 경고를 남겼다: ${JSON.stringify(warned)}`);
});

test('🔴 사용자가 «버튼으로» 시도한 실패는 콘솔에 남는다 — 진단이 필요하다', async () => {
  const src = readFileSync(new URL('../src/lib/calendarClient.js', import.meta.url), 'utf8');
  assert.match(src, /if \(interactive\) console\.warn\('\[사이\] 캘린더 인증 실패:'/);
});
