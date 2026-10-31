/**
 * 「보낼 때」 시계 판정표 (`src/liveClock.js`, 2026-10-31). 서울 기준 시각은 2026-10-31(미국 서머타임 중 ·
 * 영국·독일은 10-25에 끝남 · 시드니 서머타임 중)로 고정한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { bandPercent, gapLabel, koClock, pickScene, stateLabel } from '../src/liveClock.js';

/** 서울 2026-10-31 hh:mm → Date */
const seoul = (hh, mm = 0) => new Date(Date.UTC(2026, 9, 31, hh - 9, mm));

test('서울 19:35 → 샌프란시스코 03:35, 16시간, 예약 장면(Dana 오전 9:00 = 서울 새벽 1:00)', () => {
  const s = pickScene(seoul(19, 35), 'Asia/Seoul');
  assert.equal(s.mode, 'schedule');
  assert.deepEqual([s.me.city, s.me.time, s.me.state], ['서울', '19:35', '저녁']);
  assert.deepEqual([s.them.city, s.them.time, s.them.state], ['샌프란시스코', '03:35', '자는 시간']);
  assert.equal(s.gap, '16시간');
  assert.deepEqual([s.send.theirLabel, s.send.myLabel], ['오전 9:00', '서울 새벽 1:00']);
});

test('판정표 ① — 서울 시각에 따라 퇴근 뒤인 첫 도시', () => {
  const cases = [
    [[11, 0], '샌프란시스코', '19:00'],
    [[22, 59], '샌프란시스코', '06:59'],
    [[9, 0], '뉴욕', '20:00'],
    [[5, 0], '런던', '20:00'],
    [[3, 30], '베를린', '19:30'],
  ];
  for (const [[h, m], city, time] of cases) {
    const s = pickScene(seoul(h, m), 'Asia/Seoul');
    assert.equal(s.mode, 'schedule', `${h}:${m}`);
    assert.deepEqual([s.them.city, s.them.time], [city, time], `${h}:${m}`);
  }
});

test('판정표 ② — 서울 23:00~03:00은 맞는 도시가 없어 「지금 보내도 돼요」(샌프란시스코)', () => {
  for (const [h, m] of [[23, 0], [1, 0], [2, 59]]) {
    const s = pickScene(seoul(h, m), 'Asia/Seoul');
    assert.equal(s.mode, 'now', `${h}:${m}`);
    assert.equal(s.them.city, '샌프란시스코');
  }
});

test('방문자가 샌프란시스코면 자기 도시는 건너뛴다(4시간 미만)', () => {
  const s = pickScene(new Date(Date.UTC(2026, 9, 31, 17, 0)), 'America/Los_Angeles'); // LA 10:00
  assert.equal(s.me.city, '샌프란시스코');
  assert.notEqual(s.them.city, '샌프란시스코');
  assert.equal(s.mode, 'schedule');
  assert.equal(s.them.city, '싱가포르');
});

test('판정표 ③ — 시간대를 모르면 null(고정 예시), 표에 없는 시간대는 「내 시간」', () => {
  assert.equal(pickScene(seoul(19, 35), undefined), null);
  assert.equal(pickScene(seoul(19, 35), 'Not/AZone'), null);
  assert.equal(pickScene(seoul(19, 35), 'Africa/Nairobi').me.city, '내 시간');
});

test('표시 도우미', () => {
  assert.equal(koClock(60), '새벽 1:00');
  assert.equal(koClock(9 * 60), '오전 9:00');
  assert.equal(koClock(13 * 60 + 5), '오후 1:05');
  assert.equal(koClock(0), '새벽 12:00');
  assert.deepEqual([0, 6, 9, 12, 18, 22].map((h) => stateLabel(h * 60)), ['자는 시간', '아침', '오전', '오후', '저녁', '자는 시간']);
  assert.equal(gapLabel(-210), '3시간 30분');
  assert.equal(bandPercent(9 * 60), '37.5%');
});
