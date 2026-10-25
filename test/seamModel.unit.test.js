/**
 * Seam 대시보드 순수 계산 (2026-10-25 — 시안 「Seam」 이식).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① `byDate` → 오늘까지 이어진 날짜 줄. 없는 날은 0, 허용 밖 키·정수 아닌 값은 버린다
 *    ② 기간 = 오늘까지 N일(14·30·60·90) · 주별 흐름 판정표 — 2026-10-26 「앞 기간 비교」를 뺐다
 *    ③ 건강도 지수는 `computeHealthMetrics` 공식 그대로(100 − 마찰/다듬은 글)
 *    ④ 가장 벌어진 날은 다듬은 글 5건 미만인 날을 고르지 않는다
 *    ⑤ 다음에 할 일 판정표 · 빈 팀은 할 일 없음
 *    ⑥ 0으로 나누기·빈 배열에서 NaN/Infinity가 나오지 않는다
 *    ⑦ 팀 이름 이스케이프
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENTS, F, P, buildRows, periodRows, periodOptions, defaultPeriod, ratio, healthOf, sum,
  worstDay, dailyGap, topCause, headline, flowPill, storyFacts, weeklyFlow, flowSentence, actions, briefLines, briefText,
  weekdayFold, signalMap, safeMax, frac, isEmpty, esc, dateKey, laneHeight,
} from '../src/dashboard/seam/model.js';
import { computeHealthMetrics } from '../src/dashboard/seam/healthIndex.js';
import { FRICTION_IDS, POSITIVE_IDS } from '../src/dashboard/seam/signals.js';
import { demoTeams } from '../src/dashboard/seam/demoData.js';

const TODAY = new Date(2026, 9, 25); // 2026-10-25 (일)
const key = (back) => dateKey(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - back));
const row = (c, wd = 1) => ({ date: TODAY, wd, c });

/* ── ① 날짜 줄 ── */

test('신호 8종이 signals.js 극성과 같다 — 시안 문구만 따로 둔다', () => {
  assert.deepEqual([...F].sort(), [...FRICTION_IDS].sort());
  assert.deepEqual([...P].sort(), [...POSITIVE_IDS].sort());
  for (const e of EVENTS) assert.ok(e.label && e.desc, e.id);
});

test('byDate를 오늘까지 이어진 줄로 펼친다 — 없는 날은 0, 기록 여부를 남긴다', () => {
  const rows = buildRows({ [key(0)]: { refined: 4, misread: 1 }, [key(2)]: { refined: 2 } }, 5, TODAY);
  assert.equal(rows.length, 5);
  assert.equal(rows[4].key, key(0));
  assert.equal(rows[0].key, key(4));
  assert.deepEqual(rows[4].c, { refined: 4, misread: 1 });
  assert.equal(rows[4].recorded, true);
  assert.deepEqual(rows[3].c, {});
  assert.equal(rows[3].recorded, false);
  assert.equal(rows[4].wd, 0, '2026-10-25는 일요일');
});

test('🔴 허용 밖 키·정수가 아닌 값·음수는 버린다 — 주소창은 누구나 고칠 수 있다', () => {
  const rows = buildRows({ [key(0)]: { refined: 3.5, misread: -1, venting: '9', evil: 5, clear: 2, decoded: 7 } }, 1, TODAY);
  assert.deepEqual(rows[0].c, { clear: 2, decoded: 7 });
});

test('byDate가 없거나 이상해도 죽지 않는다', () => {
  assert.equal(buildRows(null, 14, TODAY).length, 14);
  assert.ok(isEmpty(buildRows('x', 14, TODAY)));
});

/* ── ② 기간 ── */

test('고를 수 있는 기간은 자료 범위 안의 것만 — 옛 확장(30일)은 60일을 내지 않는다', () => {
  assert.deepEqual(periodOptions(120), [14, 30, 60, 90]);
  assert.deepEqual(periodOptions(60), [14, 30, 60]);
  assert.deepEqual(periodOptions(30), [14, 30]);
  assert.equal(defaultPeriod(120), 30);
  assert.equal(defaultPeriod(30), 30);
  assert.deepEqual(periodOptions(10), [10]);
});

test('기간은 오늘까지 N일 — 자료가 짧으면 있는 만큼', () => {
  const rows = buildRows(Object.fromEntries(Array.from({ length: 120 }, (_, i) => [key(i), { refined: 1 }])), 120, TODAY);
  const cur = periodRows(rows, 30);
  assert.equal(cur.length, 30);
  assert.equal(cur[29].key, key(0));
  assert.equal(cur[0].key, key(29));
  assert.equal(periodRows(rows.slice(-20), 30).length, 20);
});

/* ── ②-1 주별 흐름 (판정표: model.js weeklyFlow) ── */

/** 오늘(10-25 일)까지 `weeks`주 — 주마다 하루 다듬은 글 `perDay`건, 오해 소지 `mis[w]`건(하루). */
function weekRows(mis, perDay = 20, extraDays = 0) {
  const n = mis.length * 7 + extraDays, byDate = {};
  for (let back = 0; back < n; back += 1) {
    const w = mis.length - 1 - Math.floor(back / 7);
    byDate[key(back)] = { refined: perDay, misread: mis[Math.max(0, w)] };
  }
  return buildRows(byDate, n, TODAY);
}

test('주별 흐름 — 월~일로 묶는다, 기간 처음에 걸린 주는 흐리게(판정 제외)', () => {
  const fl = weeklyFlow(weekRows([6, 5, 4, 3], 20, 2)); // 30일: 9/26(토)·9/27(일) + 4주
  assert.equal(fl.weeks.length, 5);
  assert.deepEqual(fl.weeks.map((w) => w.days), [2, 7, 7, 7, 7]);
  assert.equal(fl.weeks[0].used, false, '2일뿐인 주');
  assert.equal(dateKey(fl.weeks[1].start), '2026-09-28', '월요일');
  assert.equal(dateKey(fl.weeks[4].end), '2026-10-25');
  assert.equal(fl.used, 4);
});

test('주별 흐름 — 낮아짐 · 높아짐 · 비슷함 (주당 ±1%p)', () => {
  const down = weeklyFlow(weekRows([6, 5, 4, 3]));
  assert.equal(down.verdict.kind, 'down');
  assert.ok(Math.abs(down.verdict.from - 0.3) < 1e-9 && Math.abs(down.verdict.to - 0.15) < 1e-9, '직선 위의 첫 주 → 끝 주');
  assert.equal(flowSentence(down), '주별로 보면 낮아지는 흐름이에요 (30.0% → 15.0%)');
  assert.equal(dateKey(down.hi.start), '2026-09-28');
  assert.equal(dateKey(down.lo.start), '2026-10-19');
  assert.equal(weeklyFlow(weekRows([3, 4, 5, 6])).verdict.kind, 'up');
  const flat = weeklyFlow(weekRows([4, 4, 4, 4]));
  assert.equal(flat.verdict.kind, 'flat');
  assert.equal(flowSentence(flat), '주별로 보면 비슷하게 이어지고 있어요 (약 20.0%)');
});

test('🔴 주별 흐름 — 글이 30건 안 되는 주는 빼고, 쓸 주가 3개 미만이면 말하지 않는다', () => {
  const thin = weeklyFlow(weekRows([1, 1, 1, 1], 4)); // 주 28건
  assert.equal(thin.used, 0);
  assert.equal(thin.verdict.kind, 'thin');
  assert.equal(thin.hi, null);
  assert.equal(flowSentence(thin), '글이 적은 주가 많아 아직 흐름을 말하기엔 일러요');
  const two = weeklyFlow(weekRows([6, 3])); // 14일 = 2주
  assert.equal(two.used, 2);
  assert.equal(two.verdict.kind, 'thin', '14일은 주가 둘뿐');
  assert.equal(weeklyFlow([]).verdict.kind, 'thin');
});

/* ── ③ 지수 ── */

test('건강도 지수는 computeHealthMetrics 그대로 — 마찰 신호 합 / 다듬은 글', () => {
  const rows = [row({ refined: 30, misread: 3, venting: 1, clear: 9 }), row({ refined: 10, missing: 2, decoded: 50 })];
  assert.equal(healthOf(rows), computeHealthMetrics({ totalCount: 40, frictionCount: 6 }).healthIndex);
  assert.equal(healthOf(rows), 85);
  assert.equal(ratio(rows), 6 / 40);
});

test('다듬은 글이 없으면 지수도 비율도 없다(null) — 안 쓰는 팀이 만점이 되지 않는다', () => {
  assert.equal(healthOf([row({ decoded: 3 })]), null);
  assert.equal(ratio([row({})]), null);
});

/* ── ④ 가장 벌어진 날 ── */

test('🔴 가장 벌어진 날은 다듬은 글 5건 미만인 날을 고르지 않는다', () => {
  const rows = [row({ refined: 2, misread: 2 }), row({ refined: 10, misread: 3 }), row({ refined: 20, misread: 2 })];
  assert.equal(worstDay(rows), 1, '100%짜리 2건 날보다 30%짜리 10건 날');
});

test('5건 넘는 날이 없으면 다듬은 글이 있는 날 중에서, 그것도 없으면 null', () => {
  assert.equal(worstDay([row({ refined: 1 }), row({ refined: 2, venting: 1 })]), 1);
  assert.equal(worstDay([row({}), row({ decoded: 4 })]), null);
});

test('하루 벌어짐은 1에서 자른다 — 신호 수가 글 수를 넘을 수 있다', () => {
  assert.deepEqual(dailyGap([row({ refined: 2, misread: 3, venting: 2 }), row({})]), [1, 0]);
});

test('그날 가장 많은 마찰 원인 — 없으면 null', () => {
  assert.equal(topCause(row({ refined: 9, venting: 1, missing: 3 })).id, 'missing');
  assert.equal(topCause(row({ refined: 9, clear: 4 })), null);
});

/* ── 문장 ── */

test('제목 — 주별 흐름으로 말한다, 말할 수 없으면 비율만 · 빈 팀', () => {
  assert.equal(headline([row({ refined: 100, misread: 10 })], 30, '팀과 동료들 사이').rest, '마찰 비율 10.0%');
  assert.equal(headline(weekRows([6, 5, 4, 3]), 28, 'X').rest, '점점 촘촘해지고 있어요');
  assert.equal(headline(weekRows([3, 4, 5, 6]), 28, 'X').rest, '조금씩 벌어지고 있어요');
  assert.equal(headline(weekRows([4, 4, 4, 4]), 28, 'X').rest, '고르게 이어지고 있어요');
  assert.equal(headline([row({})], 30, 'X').lead, '아직 쌓인 신호가 없어요');
});

test('흐름 알약 — 오르거나 내릴 때만', () => {
  assert.deepEqual(flowPill(weekRows([6, 5, 4, 3])), { dir: 'down', text: '주별 마찰 비율 30.0% → 15.0%' });
  assert.equal(flowPill(weekRows([4, 4, 4, 4])), null);
  assert.equal(flowPill([row({ refined: 100, misread: 10 })]), null);
});

test('이야기 — 가장 큰 원인과 오프타임 요일', () => {
  const cur = [row({ refined: 10, misread: 6, venting: 2, clear: 3 }, 1), row({ refined: 10, forceOffHours: 2 }, 5)];
  const s = storyFacts(cur);
  assert.equal(s.top.id, 'misread');
  assert.equal(s.topShare, 0.6);
  assert.deepEqual(s.offTop, { wd: 5, count: 2 });
  assert.equal(s.flow.verdict.kind, 'thin');
  assert.equal('b' in s, false, '앞 기간 값이 없다');
});

test('회의용 한 장 — 화면과 복사 글이 같은 문장, 첫 줄은 이 기간 비율과 주별 흐름', () => {
  const cur = [row({ refined: 40, misread: 4, clear: 2, decoded: 10, decodeUrgencyGap: 3 })];
  const lines = briefLines(cur, 30);
  assert.equal(lines[0], '협업 건강도 90.0 — 지난 30일 마찰 비율 10.0%, 글이 적은 주가 많아 아직 흐름을 말하기엔 일러요.');
  assert.equal(briefLines(weekRows([6, 5, 4, 3]), 28)[0], '협업 건강도 77.5 — 지난 28일 마찰 비율 22.5%, 주별로 보면 낮아지는 흐름이에요 (30.0% → 15.0%).');
  assert.match(lines[1], /마찰의 100%가 「오해 소지 표현」/);
  assert.equal(lines[2], '상대 쪽에서 온 글 10건 중 30%는 겉말과 실제 의도가 달랐어요.');
  const text = briefText({ pairLabel: '우리팀 ↔ 주고받은 동료들', days: 30, lines, next: { title: 'T', why: 'W' } });
  assert.ok(text.startsWith('[우리팀 ↔ 주고받은 동료들 · 최근 30일]\n1. 협업 건강도'));
  assert.ok(text.endsWith('→ 이번 주에 하나만: T (W)'));
});

/* ── ⑤ 다음에 할 일 ── */

test('할 일 판정표 — 비중 30% 이상 · 받은 글 · Critical · 용어집 (앞 기간 비교 없음)', () => {
  const cur = [row({ refined: 100, misread: 10, venting: 5, decoded: 10, decodeUrgencyGap: 4, urgencyCritical: 20, urgencyNormal: 60, urgencyLow: 20, teamGlossaryApplied: 10 })];
  const list = actions(cur);
  const ids = list.map((a) => a.id);
  assert.ok(ids.includes('misread'), '마찰의 67%');
  assert.ok(ids.includes('venting'), '마찰의 33%');
  assert.ok(ids.includes('inbound'), '받은 글 40%');
  assert.ok(ids.includes('critical'), 'Critical 20%');
  assert.ok(ids.includes('glossary'), '용어집 10%');
  assert.equal(list.find((a) => a.id === 'venting').why, '마찰의 33% · 5건');
  assert.equal(ids[0], 'misread', '비중이 가장 큰 것이 먼저');
  assert.ok(list.filter((a) => a.id !== 'inbound').every((a) => a.hot === false), '「늘고 있음」은 없다');
});

test('할 일은 최대 5개이고, 기준 밑이면 내지 않는다', () => {
  const quiet = [row({ refined: 100, misread: 1, missing: 1, venting: 1, urgencyGap: 1, forceOffHours: 1, decoded: 4, decodeUrgencyGap: 4, urgencyNormal: 100, teamGlossaryApplied: 50 })];
  assert.deepEqual(actions(quiet), [], '각 20% · 받은 글 5건 미만 · Critical 0 · 용어집 50%');
  const busy = [row({ refined: 10, misread: 9, venting: 9, decoded: 9, decodeUrgencyGap: 9, urgencyCritical: 9, urgencyNormal: 1 })];
  assert.ok(actions(busy).length <= 5);
});

test('🔴 빈 팀에는 할 일을 내지 않는다 — 근거 없는 「용어집을 채우세요」를 막는다', () => {
  assert.deepEqual(actions([row({})]), []);
});

test('오프타임 강행 할 일은 몰린 요일을 말한다', () => {
  const cur = [row({ refined: 10, forceOffHours: 4 }, 4), row({ refined: 10, forceOffHours: 1 }, 2)];
  assert.match(actions(cur).find((a) => a.id === 'forceOffHours').body, /^목요일에 4건이 몰렸어요\./);
});

/* ── ⑥ NaN 방어 ── */

test('🔴 막대 분모는 1 아래로 내려가지 않는다 — 빈 배열·0·NaN에서도 유한하다', () => {
  assert.equal(safeMax([]), 1);
  assert.equal(safeMax([0, 0]), 1);
  assert.equal(safeMax([NaN, 3, Infinity]), 3);
  assert.equal(frac(1, 0), 0);
  assert.equal(frac(NaN, 4), 0);
  assert.equal(frac(5, 4), 1);
  const fold = weekdayFold([row({})]);
  assert.equal(fold.maxR, 1);
  assert.equal(fold.peak, -1);
  for (const t of signalMap([row({}), row({})], []).groups.flatMap((g) => g.rows)) assert.ok(Number.isFinite(t.max) && t.max >= 1);
});

test('요일의 결 — 다듬은 글이 있는 요일 중 마찰 비율이 가장 높은 요일', () => {
  const fold = weekdayFold([row({ refined: 10, misread: 1 }, 1), row({ refined: 4, misread: 2 }, 3), row({ refined: 0, venting: 5 }, 6)]);
  assert.equal(fold.peak, 3);
  assert.equal(fold.by[6].f, 5);
});

/* ── ⑦ 이스케이프 ── */

test('🔴 팀 이름의 HTML은 글자로만 그린다', () => {
  assert.equal(esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});

/* ── 실데이터 경로 ── */

// 🔴 0.1.21 — `#sai=` 경로(coverageDaysOf·readLiveScenarios)는 없앴다. 자료 범위는 확장 대시보드의 캐시가 정한다
//    (`test/dashboardOnDemand.unit.test.js`).

test('예시 데이터는 실데이터와 같은 모양(byDate 120일)으로 같은 길을 지난다', () => {
  const teams = demoTeams(TODAY);
  assert.equal(teams.length, 3);
  for (const t of teams) {
    assert.equal(Object.keys(t.byDate).length, 120);
    const rows = buildRows(t.byDate, t.coverageDays, TODAY);
    assert.equal(sum(rows, ['refined']) > 0, true);
    assert.ok(rows.every((d) => (d.c.clear || 0) <= (d.c.misread || 0)), 'clear는 misread를 넘지 않는다');
    assert.ok(rows.every((d) => (d.c.decodeUrgencyGap || 0) <= (d.c.decoded || 0)));
  }
});

/* ── 장부 두 줄 (2026-10-25 사용자 지적: 마찰·긍정이 한눈에 안 읽힘) ── */

test('장부 막대 — 제곱근 눈금, 0이 아니면 최소 3px, 0이면 0', () => {
  assert.equal(laneHeight(0, 10, 30), 0);
  assert.equal(laneHeight(10, 10, 30), 30);
  assert.equal(laneHeight(1, 100, 30), 3, '1/100 → sqrt 0.1 × 30 = 3');
  assert.equal(laneHeight(1, 10000, 30), 3, '아주 작아도 3px');
  assert.ok(Math.abs(laneHeight(25, 100, 40) - 20) < 1e-9, 'sqrt(0.25) × 40');
});

test('🔴 장부 막대는 분모가 0·NaN이어도 유한하고 줄 높이를 넘지 않는다', () => {
  for (const [c, m, h] of [[3, 0, 30], [3, NaN, 30], [NaN, 5, 30], [50, 5, 30], [2, 1, -4]]) {
    const v = laneHeight(c, m, h);
    assert.ok(Number.isFinite(v), `${c}/${m}`);
    assert.ok(v <= Math.max(3, h), `${c}/${m} → ${v}`);
  }
});
