/**
 * S23 — 회의 시간 추천(타임존 겹침) + 양보 포인트 (Spec 권장 12 · §1 Token Economy).
 *
 * 🔴 핵심 검증:
 *    ① 양쪽 다 업무시간 밖인 시간은 **제안하지 않는다**(아무에게도 좋지 않은 시간).
 *    ② 양보 주체를 정확히 가른다 — 포인트는 **내가 양보했을 때만** 붙는다.
 *    ③ 주말은 어느 한쪽 기준으로도 걸리면 제외.
 *    ④ 포인트 사유는 고정 집합만 — 자유 문자열은 적립되지 않는다(본문 유입 경로 차단).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findMeetingSlots,
  SLOT_KINDS,
  YIELD_POINTS,
  DEFAULT_WORK_START,
  DEFAULT_WORK_END,
} from '../src/core/meeting/overlap.js';
import {
  getPoints,
  awardPoints,
  clearPoints,
  POINT_REASONS,
  POINT_AMOUNTS,
  MAX_HISTORY,
} from '../src/lib/points.js';

/* ── 판정표 A — 슬롯 계산 ────────────────────────────────────────────── */

// 2026-08-17은 월요일 — 주말 규칙에 걸리지 않는 기준일로 쓴다.
const MONDAY = new Date('2026-08-17T00:00:00Z');

test('서울↔베를린: 양쪽 업무시간이 겹치는 시간을 찾아낸다', () => {
  const { slots, hasComfortable } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'Europe/Berlin',
  });
  assert.ok(slots.length > 0, '후보가 하나도 없으면 안 된다');
  assert.equal(hasComfortable, true, '서울↔베를린은 오후에 겹치는 시간이 존재한다');
});

test('🔴 모든 후보는 최소 한쪽이 업무시간 안이다 — 양쪽 다 밖인 시간은 제안하지 않는다', () => {
  const { slots } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'America/New_York',
    limit: 50,
  });
  const inWork = (h) => h >= DEFAULT_WORK_START && h < DEFAULT_WORK_END;
  for (const slot of slots) {
    assert.ok(
      inWork(slot.mine.hour) || inWork(slot.theirs.hour),
      `양쪽 다 업무시간 밖인 슬롯이 섞였다: 내 ${slot.mine.hour}시 / 상대 ${slot.theirs.hour}시`,
    );
  }
});

test('🔴 comfortable 슬롯은 양쪽 모두 업무시간 안이다', () => {
  const { slots } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'Europe/Berlin',
    limit: 50,
  });
  const inWork = (h) => h >= DEFAULT_WORK_START && h < DEFAULT_WORK_END;
  for (const slot of slots.filter((s) => s.kind === SLOT_KINDS.COMFORTABLE)) {
    assert.ok(inWork(slot.mine.hour) && inWork(slot.theirs.hour));
  }
});

test('🔴 포인트는 내가 양보한 슬롯에만 붙는다', () => {
  const { slots } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'America/New_York',
    limit: 50,
  });
  for (const slot of slots) {
    if (slot.kind === SLOT_KINDS.I_YIELD) {
      assert.equal(slot.yieldPoints, YIELD_POINTS);
    } else {
      assert.equal(slot.yieldPoints, 0, `${slot.kind}에 양보 포인트가 붙으면 안 된다`);
    }
  }
});

test('편한 시간이 있으면 목록 맨 앞에 온다 — 양보를 먼저 권하지 않는다', () => {
  const { slots, hasComfortable } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'Europe/Berlin',
  });
  if (hasComfortable) {
    assert.equal(slots[0].kind, SLOT_KINDS.COMFORTABLE);
  }
});

test('🔴 주말은 어느 한쪽 기준으로도 제외된다', () => {
  // 2026-08-21은 금요일 — 앞으로 5일을 보면 토·일이 포함된다.
  const { slots } = findMeetingSlots({
    now: new Date('2026-08-21T00:00:00Z'),
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'America/New_York',
    limit: 100,
  });
  for (const slot of slots) {
    assert.ok(slot.mine.weekday !== 0 && slot.mine.weekday !== 6, '내 기준 주말이 섞였다');
    assert.ok(slot.theirs.weekday !== 0 && slot.theirs.weekday !== 6, '상대 기준 주말이 섞였다');
  }
});

/**
 * 🔴 실사용에서 드러난 결함(2026-08-13 사용자 지적): 서울↔뉴욕처럼 겹치는 시간이 없으면
 *    `they-yield`가 상한을 전부 차지해 **양보 선택지가 화면에서 사라졌다**. 그러면 양보
 *    포인트(Spec §1)가 영영 발동하지 않는다.
 */
test('🔴 겹치는 시간이 없으면 두 양보 방향이 모두 목록에 나온다', () => {
  const { slots, hasComfortable } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'America/New_York',
    limit: 5,
  });
  assert.equal(hasComfortable, false, '서울↔뉴욕은 09~18시가 겹치지 않는다');
  assert.ok(
    slots.some((s) => s.kind === SLOT_KINDS.I_YIELD),
    '내가 양보하는 선택지가 한 칸도 없으면 양보 포인트가 발동할 수 없다',
  );
  assert.ok(
    slots.some((s) => s.kind === SLOT_KINDS.THEY_YIELD),
    '상대가 양보하는 선택지도 함께 보여야 비교가 된다',
  );
});

test('편한 시간이 충분하면 양보 슬롯으로 자리를 채우지 않는다', () => {
  const { slots } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'Asia/Tokyo', // 시차 0 — 편한 시간이 넘친다
    limit: 5,
  });
  assert.equal(slots.length, 5);
  assert.ok(slots.every((s) => s.kind === SLOT_KINDS.COMFORTABLE));
});

test('타임존이 없으면 조용히 빈 결과 — 지어내지 않는다', () => {
  assert.deepEqual(findMeetingSlots({ myTimeZone: 'Asia/Seoul', theirTimeZone: null }), {
    slots: [],
    hasComfortable: false,
  });
});

test('limit을 넘겨 반환하지 않는다', () => {
  const { slots } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'Europe/Berlin',
    limit: 3,
  });
  assert.ok(slots.length <= 3);
});

test('업무시간을 좁히면 후보도 줄어든다 — 설정이 실제로 반영된다', () => {
  const wide = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'Europe/Berlin',
    limit: 100,
  });
  const narrow = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'Europe/Berlin',
    workStart: 10,
    workEnd: 12,
    limit: 100,
  });
  assert.ok(narrow.slots.length < wide.slots.length);
});

test('🔴 반환값에 사람에 대한 점수·등급이 없다 (필수 9 G1/G2)', () => {
  const { slots } = findMeetingSlots({
    now: MONDAY,
    myTimeZone: 'Asia/Seoul',
    theirTimeZone: 'Europe/Berlin',
    limit: 3,
  });
  for (const slot of slots) {
    const keys = Object.keys(slot).sort();
    assert.deepEqual(keys, ['kind', 'mine', 'startUtcISO', 'theirs', 'yieldPoints']);
  }
});

/* ── 판정표 B — 포인트 ───────────────────────────────────────────────── */

test('회의 양보 시 Spec 명시액(+50P)이 적립된다', async () => {
  await clearPoints();
  const result = await awardPoints(POINT_REASONS.MEETING_YIELD);
  assert.equal(result.ok, true);
  assert.equal(result.amount, POINT_AMOUNTS[POINT_REASONS.MEETING_YIELD]);
  assert.equal(result.balance, 50);
});

test('적립이 누적된다', async () => {
  await clearPoints();
  await awardPoints(POINT_REASONS.MEETING_YIELD);
  const second = await awardPoints(POINT_REASONS.FEEDBACK);
  assert.equal(second.balance, 55);
});

test('🔴 고정 집합에 없는 사유는 적립되지 않는다 — 사유가 자유 문자열이 되면 본문이 들어올 수 있다', async () => {
  await clearPoints();
  const result = await awardPoints('사용자가 쓴 아무 문장');
  assert.equal(result.ok, false);
  assert.equal(result.balance, 0);
  const stored = await getPoints();
  assert.equal(stored.history.length, 0);
});

test('🔴 저장된 내역에 본문이 들어갈 필드가 없다 (Spec 필수 5)', async () => {
  await clearPoints();
  await awardPoints(POINT_REASONS.MEETING_YIELD);
  const { history } = await getPoints();
  assert.deepEqual(Object.keys(history[0]).sort(), ['amount', 'at', 'reason']);
});

test('내역은 상한을 넘지 않는다', async () => {
  await clearPoints();
  for (let i = 0; i < MAX_HISTORY + 5; i += 1) {
    await awardPoints(POINT_REASONS.FEEDBACK);
  }
  const { history, balance } = await getPoints();
  assert.equal(history.length, MAX_HISTORY);
  assert.equal(balance, (MAX_HISTORY + 5) * POINT_AMOUNTS[POINT_REASONS.FEEDBACK], '잔액은 잘리지 않는다');
});

test('초기화하면 잔액과 내역이 모두 비워진다', async () => {
  await awardPoints(POINT_REASONS.MEETING_YIELD);
  await clearPoints();
  assert.deepEqual(await getPoints(), { balance: 0, history: [] });
});
