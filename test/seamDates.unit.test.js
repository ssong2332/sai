/**
 * Seam 「어떤 신호가, 언제」(신호 지도) 순수 계산 (2026-10-25 날짜별 → 2026-10-26 신호 지도로 합침).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 날짜 고르기 — 켜고 끄기, Shift 범위는 기준~누른 날을 모두 켬, 범위 밖은 무시, 항상 오름차순·중복 없음
 *    ② 고른 날 합계 — 다듬은 글·마찰·긍정이 고른 날만 더해진다(중복 번호를 두 번 세지 않는다)
 *    ③ 신호 지도 — 줄 순서·날마다 값·줄마다 색 단계·고른 날 합계 (앞 기간 값 없음)
 *    ④ 칸 색 단계 — 0건은 0, 그 밖은 1~4, NaN·0 분모에서도 깨지지 않는다
 *    ⑤ 같은 `rows`(buildRows)만 받는다 — 자료 출처를 가정하지 않는다
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  F, P, buildRows, dateKey, rangeIndices, pickDays, selectedSummary, heatLevel, signalMap,
} from '../src/dashboard/seam/model.js';

const TODAY = new Date(2026, 9, 25); // 2026-10-25 (일)
const key = (back) => dateKey(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - back));

/* 5일: 10-21(수) … 10-25(일). 칸 번호 0 = 10-21 */
const rows = buildRows({
  [key(4)]: { refined: 6, misread: 2, clear: 1 },
  [key(3)]: { refined: 3, urgencyGap: 1, venting: 1 },
  [key(2)]: { refined: 0 },
  [key(1)]: { refined: 8, misread: 4, schedule: 2 },
  [key(0)]: { refined: 1 },
}, 5, TODAY);

/* ── ① 고르기 ── */

test('rangeIndices — 순서 무관, 범위 밖은 자른다', () => {
  assert.deepEqual(rangeIndices(3, 1), [1, 2, 3]);
  assert.deepEqual(rangeIndices(-2, 1, 5), [0, 1]);
  assert.deepEqual(rangeIndices(3, 9, 5), [3, 4]);
});

test('pickDays — 그냥 누르면 켜고 끈다', () => {
  assert.deepEqual(pickDays([], 2, { n: 5 }), [2]);
  assert.deepEqual(pickDays([2], 2, { n: 5 }), []);
  assert.deepEqual(pickDays([3], 1, { n: 5 }), [1, 3], '오름차순');
});

test('pickDays — Shift는 기준 날 ~ 누른 날을 모두 켠다(이미 고른 날은 그대로)', () => {
  assert.deepEqual(pickDays([1], 4, { shift: true, anchor: 1, n: 5 }), [1, 2, 3, 4]);
  assert.deepEqual(pickDays([0, 3], 1, { shift: true, anchor: 3, n: 5 }), [0, 1, 2, 3], '거꾸로도');
  assert.deepEqual(pickDays([2], 2, { shift: true, anchor: 2, n: 5 }), [2], 'Shift로는 끄지 않는다');
  assert.deepEqual(pickDays([2], 4, { shift: true, anchor: null, n: 5 }), [2, 4], '기준 날이 없으면 그냥 누름');
});

test('pickDays — 범위 밖·이상한 값은 무시하고 기존 고른 날도 걸러낸다', () => {
  assert.deepEqual(pickDays([1, 9, -1, 1.5], 7, { n: 5 }), [1]);
  assert.deepEqual(pickDays(null, NaN, { n: 5 }), []);
});

/* ── ② 합계 ── */

test('selectedSummary — 고른 날만, 중복 번호는 한 번만', () => {
  assert.deepEqual(selectedSummary(rows, [0, 3]), { days: 2, refined: 14, f: 6, p: 3 });
  assert.deepEqual(selectedSummary(rows, [3, 3, 0]), { days: 2, refined: 14, f: 6, p: 3 });
  assert.deepEqual(selectedSummary(rows, []), { days: 0, refined: 0, f: 0, p: 0 });
  assert.deepEqual(selectedSummary(rows, [99]), { days: 0, refined: 0, f: 0, p: 0 }, '범위 밖은 버린다');
});

/* ── ③ 신호 지도 ── */

test('signalMap — 다듬은 글 + 마찰 무리 → 긍정 무리, 날마다 값·합계', () => {
  const m = signalMap(rows, []);
  assert.deepEqual(m.refined.vals, [6, 3, 0, 8, 1]);
  assert.equal(m.refined.tot, 18);
  assert.deepEqual(m.groups.map((g) => g.kind), ['f', 'p']);
  assert.equal(m.groups[0].rows.length, F.length, '0건 줄도 뺀 적 없다 — 늘 같은 자리');
  assert.equal(m.groups[1].rows.length, P.length);
  const mis = m.groups[0].rows.find((r) => r.id === 'misread');
  assert.deepEqual(mis.vals, [2, 0, 0, 4, 0]);
  assert.equal(mis.tot, 6);
  assert.equal(m.groups[0].tot, 8, '마찰 = 오해 6 + 긴급도 1 + 하소연 1');
  assert.equal(m.groups[1].tot, 3);
});

test('signalMap — 칸 색은 그 줄의 하루 최대 기준(드문 신호도 가장 많은 날이 4)', () => {
  const m = signalMap(rows, []);
  const rowOf = (id) => m.groups.flatMap((g) => g.rows).find((r) => r.id === id);
  assert.deepEqual(rowOf('misread').levels, [3, 0, 0, 4, 0]);
  assert.deepEqual(rowOf('venting').levels, [0, 4, 0, 0, 0], '하루 1건뿐이어도 그 줄에선 가장 짙다');
  assert.ok(rowOf('forceOffHours').levels.every((v) => v === 0), '0건 줄 — 0으로 나누지 않는다');
});

test('signalMap — 고른 날 합계는 고른 날만, 없으면 null', () => {
  const none = signalMap(rows, []);
  assert.equal(none.refined.sel, null);
  assert.equal(none.groups[0].sel, null);
  assert.equal(none.first, null);
  const m = signalMap(rows, [3, 0, 3, 99]);
  assert.deepEqual(m.picked, [0, 3], '중복·범위 밖은 버리고 날짜 순');
  assert.equal(m.refined.sel, 14);
  assert.equal(m.groups[0].sel, 6);
  assert.equal(m.groups[1].sel, 3);
  assert.deepEqual(m.days.map((d) => d.on), [true, false, false, true, false]);
  assert.equal(dateKey(m.first), key(4));
  assert.equal(dateKey(m.last), key(1));
});

test('signalMap — 앞 기간 값이 없다(2026-10-26 비교를 뺐다)', () => {
  const m = signalMap(rows, []);
  assert.ok(m.groups.flatMap((g) => g.rows).every((r) => !('pt' in r) && !('dir' in r)));
  assert.equal('pt' in m.groups[0], false);
});

test('signalMap — 주말·달 첫날 표시', () => {
  const m = signalMap(rows, []);
  assert.deepEqual(m.days.map((d) => d.weekend), [false, false, false, true, true], '10-24 토 · 10-25 일');
  assert.equal(m.days[0].monthStart, true, '첫 칸은 달을 적는다');
  const oct = signalMap(buildRows({}, 30, TODAY), []);
  assert.deepEqual(oct.days.filter((d) => d.monthStart).map((d) => dateKey(d.date)), ['2026-09-26', '2026-10-01']);
});

/* ── ④ 칸 색 ── */

test('heatLevel — 0건은 0, 최대는 4, 깨진 값에도 범위 안', () => {
  assert.equal(heatLevel(0, 10), 0);
  assert.equal(heatLevel(10, 10), 4);
  assert.equal(heatLevel(1, 100), 1);
  assert.ok(heatLevel(3, 10) >= 1 && heatLevel(3, 10) <= 4);
  for (const [c, m] of [[NaN, 5], [3, 0], [3, NaN], [-1, 5], [50, 5]]) {
    const v = heatLevel(c, m);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 4, `${c}/${m} → ${v}`);
  }
});
