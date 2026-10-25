/**
 * Seam 「실마다 따로 보기 — 날짜별」 순수 계산 (2026-10-25 사용자 피드백).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 날짜 고르기 — 켜고 끄기, Shift 범위는 기준~누른 날을 모두 켬, 범위 밖은 무시, 항상 오름차순·중복 없음
 *    ② 고른 날 합계 — 다듬은 글·마찰·긍정이 고른 날만 더해진다(중복 번호를 두 번 세지 않는다)
 *    ③ 표 — 마찰 무리 → 긍정 무리, 0건 줄 숨김/보기, 7일 넘으면 접기
 *    ④ 칸 색 단계 — 0건은 0, 그 밖은 1~4, NaN·0 분모에서도 깨지지 않는다
 *    ⑤ 같은 `rows`(buildRows)만 받는다 — 자료 출처를 가정하지 않는다
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  F, P, buildRows, dateKey, rangeIndices, pickDays, selectedSummary, heatLevel, dayStrip, dayTable, DAY_COLS_MAX,
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

/* ── ③ 표 ── */

test('dayTable — 마찰 무리 → 긍정 무리, 날짜 순 칸, 0건 줄은 숨긴다', () => {
  const t = dayTable(rows, [3, 0]);
  assert.deepEqual(t.cols.map((c) => c.key), [key(4), key(1)], '날짜 순');
  assert.deepEqual(t.cols.map((c) => c.refined), [6, 8]);
  assert.equal(t.compact, false);
  assert.deepEqual(t.groups.map((g) => g.kind), ['f', 'p']);
  const [fg, pg] = t.groups;
  assert.deepEqual(fg.rows.map((r) => [r.id, r.vals, r.tot]), [['misread', [2, 4], 6]]);
  assert.equal(fg.tot, 6);
  assert.equal(fg.hidden, F.length - 1);
  assert.deepEqual(pg.rows.map((r) => [r.id, r.tot]), [['clear', 1], ['schedule', 2]]);
  assert.equal(t.hidden, F.length - 1 + P.length - 2);
});

test('dayTable — showZero면 여덟 줄 모두, 숨긴 줄 0', () => {
  const t = dayTable(rows, [2], { showZero: true });
  assert.equal(t.groups[0].rows.length, F.length);
  assert.equal(t.groups[1].rows.length, P.length);
  assert.equal(t.hidden, 0);
  for (const g of t.groups) for (const r of g.rows) assert.equal(r.share, 0, '0건이면 막대 0 — NaN 아님');
});

test('dayTable — 막대 비율은 0~1, 가장 큰 줄이 1', () => {
  const t = dayTable(rows, [0, 1, 3]);
  const all = t.groups.flatMap((g) => g.rows);
  for (const r of all) assert.ok(r.share >= 0 && r.share <= 1, r.id);
  assert.equal(all.find((r) => r.id === 'misread').share, 1);
});

test(`dayTable — ${DAY_COLS_MAX}일을 넘으면 접는다(합계만)`, () => {
  const long = buildRows({}, 30, TODAY);
  assert.equal(dayTable(long, rangeIndices(0, DAY_COLS_MAX - 1)).compact, false);
  assert.equal(dayTable(long, rangeIndices(0, DAY_COLS_MAX)).compact, true);
});

test('dayTable — 아무 날도 안 고르면 빈 칸·0', () => {
  const t = dayTable(rows, []);
  assert.equal(t.cols.length, 0);
  assert.deepEqual(t.groups.map((g) => g.rows.length), [0, 0]);
  assert.deepEqual(t.groups.map((g) => g.tot), [0, 0]);
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

test('dayStrip — 칸마다 마찰 신호 수·단계·주말·달 첫날', () => {
  const s = dayStrip(rows);
  assert.deepEqual(s.map((c) => c.f), [2, 2, 0, 4, 0]);
  assert.deepEqual(s.map((c) => c.level), [3, 3, 0, 4, 0]);
  assert.deepEqual(s.map((c) => c.weekend), [false, false, false, true, true], '10-24 토 · 10-25 일');
  assert.equal(s[0].monthStart, true, '첫 칸은 달을 적는다');
  const oct = dayStrip(buildRows({}, 30, TODAY));
  assert.deepEqual(oct.filter((c) => c.monthStart).map((c) => dateKey(c.date)), ['2026-09-26', '2026-10-01']);
  assert.ok(oct.every((c) => c.level === 0), '빈 기간 — 0으로 나누지 않는다');
});
