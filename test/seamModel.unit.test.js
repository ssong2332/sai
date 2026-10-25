/**
 * Seam 대시보드 순수 계산 (2026-10-25 — 시안 「Seam」 이식).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① `byDate` → 오늘까지 이어진 날짜 줄. 없는 날은 0, 허용 밖 키·정수 아닌 값은 버린다
 *    ② 기간 나누기 — 앞 기간이 자료 범위 밖이거나 비었으면 비교하지 않는다(지어내지 않는다)
 *    ③ 건강도 지수는 `computeHealthMetrics` 공식 그대로(100 − 마찰/다듬은 글)
 *    ④ 가장 벌어진 날은 다듬은 글 5건 미만인 날을 고르지 않는다
 *    ⑤ 다음에 할 일 판정표 · 빈 팀은 할 일 없음
 *    ⑥ 0으로 나누기·빈 배열에서 NaN/Infinity가 나오지 않는다
 *    ⑦ 팀 이름 이스케이프
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENTS, F, P, buildRows, splitWindow, periodOptions, defaultPeriod, ratio, healthOf, sum,
  worstDay, dailyGap, topCause, headline, deltaOf, storyFacts, actions, briefLines, briefText,
  weekdayFold, threadRows, safeMax, frac, isEmpty, esc, dateKey, laneHeight,
} from '../dashboard/src/seam/model.js';
import { computeHealthMetrics } from '../dashboard/src/healthIndex.js';
import { FRICTION_IDS, POSITIVE_IDS, readLiveScenarios, coverageDaysOf } from '../dashboard/src/liveData.js';
import { demoTeams } from '../dashboard/src/seam/demoData.js';

const TODAY = new Date(2026, 9, 25); // 2026-10-25 (일)
const key = (back) => dateKey(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - back));
const row = (c, wd = 1) => ({ date: TODAY, wd, c });

/* ── ① 날짜 줄 ── */

test('신호 8종이 liveData 극성과 같다 — 시안 문구만 따로 둔다', () => {
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
  assert.deepEqual(periodOptions(120), [14, 30, 60]);
  assert.deepEqual(periodOptions(30), [14, 30]);
  assert.equal(defaultPeriod(120), 30);
  assert.equal(defaultPeriod(30), 30);
  assert.deepEqual(periodOptions(10), [10]);
});

test('앞 기간은 바로 앞 같은 길이 — 자료 범위 밖이면 비교하지 않는다', () => {
  const rows = buildRows(Object.fromEntries(Array.from({ length: 120 }, (_, i) => [key(i), { refined: 1 }])), 120, TODAY);
  const w30 = splitWindow(rows, 30);
  assert.equal(w30.cur.length, 30);
  assert.equal(w30.prev.length, 30);
  assert.equal(w30.cur[29].key, key(0));
  assert.equal(w30.prev[29].key, key(30));
  assert.equal(splitWindow(rows.slice(-30), 30).prev.length, 0, '30일 자료로 30일을 고르면 앞 기간 없음');
  assert.equal(splitWindow(rows.slice(-30), 14).prev.length, 14, '30일 자료로 14일은 비교 가능');
});

test('🔴 앞 기간에 다듬은 글이 하나도 없으면 비교하지 않는다 — 0과 비교해 「늘었어요」를 만들지 않는다', () => {
  const rows = buildRows({ [key(0)]: { refined: 10, misread: 2 } }, 60, TODAY);
  const { prev } = splitWindow(rows, 30);
  assert.equal(prev.length, 0);
  assert.equal(deltaOf(splitWindow(rows, 30).cur, prev, 30), null);
  assert.ok(threadRows(splitWindow(rows, 30).cur, prev).every((t) => t.pt == null));
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

test('제목 — 앞 기간 없음 · 거의 같음 · 촘촘해짐 · 벌어짐 · 빈 팀', () => {
  const cur = [row({ refined: 100, misread: 10 })];
  assert.equal(headline(cur, [], 30, '팀과 동료들 사이').rest, '마찰 비율 10.0%');
  assert.equal(headline(cur, [row({ refined: 100, misread: 10.2 })], 30, 'X').rest, '거의 같아요');
  assert.equal(headline(cur, [row({ refined: 100, misread: 20 })], 30, 'X').rest, '더 촘촘해졌어요');
  assert.equal(headline(cur, [row({ refined: 100, misread: 2 })], 30, 'X').rest, '조금 벌어졌어요');
  assert.equal(headline([row({})], [], 30, 'X').lead, '아직 쌓인 신호가 없어요');
});

test('변화 알약 — %p로 말한다', () => {
  const d = deltaOf([row({ refined: 100, misread: 8 })], [row({ refined: 100, misread: 10 })], 14);
  assert.deepEqual(d, { dir: 'down', text: '앞 14일보다 마찰 비율 2.0%p 줄었어요' });
});

test('이야기 — 가장 큰 원인과 오프타임 요일', () => {
  const cur = [row({ refined: 10, misread: 6, venting: 2, clear: 3 }, 1), row({ refined: 10, forceOffHours: 2 }, 5)];
  const s = storyFacts(cur, []);
  assert.equal(s.top.id, 'misread');
  assert.equal(s.topShare, 0.6);
  assert.deepEqual(s.offTop, { wd: 5, count: 2 });
  assert.equal(s.b, null);
});

test('회의용 한 장 — 화면과 복사 글이 같은 문장, 앞 기간이 없으면 그렇게 말한다', () => {
  const cur = [row({ refined: 40, misread: 4, clear: 2, decoded: 10, decodeUrgencyGap: 3 })];
  const lines = briefLines(cur, [], 30);
  assert.equal(lines[0], '협업 건강도 90.0 — 비교할 앞 기간이 없어요.');
  assert.match(lines[1], /마찰의 100%가 「오해 소지 표현」/);
  assert.equal(lines[2], '상대 쪽에서 온 글 10건 중 30%는 겉말과 실제 의도가 달랐어요.');
  const text = briefText({ pairLabel: '우리팀 ↔ 주고받은 동료들', days: 30, lines, next: { title: 'T', why: 'W' } });
  assert.ok(text.startsWith('[우리팀 ↔ 주고받은 동료들 · 최근 30일]\n1. 협업 건강도'));
  assert.ok(text.endsWith('→ 이번 주에 하나만: T (W)'));
});

/* ── ⑤ 다음에 할 일 ── */

test('할 일 판정표 — 비중 30% 이상 · 1.3배 증가 · 받은 글 · Critical · 용어집', () => {
  const cur = [row({ refined: 100, misread: 10, venting: 5, decoded: 10, decodeUrgencyGap: 4, urgencyCritical: 20, urgencyNormal: 60, urgencyLow: 20, teamGlossaryApplied: 10 })];
  const prev = [row({ refined: 100, misread: 10, venting: 2 })];
  const ids = actions(cur, prev).map((a) => a.id);
  assert.ok(ids.includes('misread'), '마찰의 67%');
  assert.ok(ids.includes('venting'), '2 → 5 (1.3배 이상, 3건 이상)');
  assert.ok(ids.includes('inbound'), '받은 글 40%');
  assert.ok(ids.includes('critical'), 'Critical 20%');
  assert.ok(ids.includes('glossary'), '용어집 10%');
  const venting = actions(cur, prev).find((a) => a.id === 'venting');
  assert.equal(venting.hot, true);
  assert.equal(venting.why, '앞 기간 2건 → 5건');
  assert.equal(ids[0], 'venting', '늘고 있는 것이 먼저(+0.5)');
});

test('할 일은 최대 5개이고, 기준 밑이면 내지 않는다', () => {
  const quiet = [row({ refined: 100, misread: 1, missing: 1, venting: 1, urgencyGap: 1, forceOffHours: 1, decoded: 4, decodeUrgencyGap: 4, urgencyNormal: 100, teamGlossaryApplied: 50 })];
  assert.deepEqual(actions(quiet, []), [], '각 20% · 받은 글 5건 미만 · Critical 0 · 용어집 50%');
  const busy = [row({ refined: 10, misread: 9, venting: 9, decoded: 9, decodeUrgencyGap: 9, urgencyCritical: 9, urgencyNormal: 1 })];
  assert.ok(actions(busy, []).length <= 5);
});

test('🔴 빈 팀에는 할 일을 내지 않는다 — 근거 없는 「용어집을 채우세요」를 막는다', () => {
  assert.deepEqual(actions([row({})], []), []);
});

test('오프타임 강행 할 일은 몰린 요일을 말한다', () => {
  const cur = [row({ refined: 10, forceOffHours: 4 }, 4), row({ refined: 10, forceOffHours: 1 }, 2)];
  assert.match(actions(cur, []).find((a) => a.id === 'forceOffHours').body, /^목요일에 4건이 몰렸어요\./);
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
  for (const t of threadRows([row({}), row({})], [])) assert.ok(Number.isFinite(t.max) && t.max >= 1);
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

function encode(payload) {
  return Buffer.from(unescape(encodeURIComponent(JSON.stringify(payload))), 'binary').toString('base64');
}

test('자료 범위(days)를 확장 페이로드에서 읽는다 — 없으면 옛 확장의 30일', () => {
  assert.equal(coverageDaysOf({ days: 120 }), 120);
  assert.equal(coverageDaysOf({}), 30);
  assert.equal(coverageDaysOf({ days: 'x' }), 30);
  assert.equal(coverageDaysOf({ days: 9999 }), 30);
  const [s] = readLiveScenarios(`#sai=${encode({ days: 120, teams: [{ teamName: '팀', counts: {}, byDate: {} }] })}`);
  assert.equal(s.coverageDays, 120);
  assert.equal(s.label, '최근 120일');
});

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
