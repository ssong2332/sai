/**
 * 확장 안 팀 대시보드 — 필요한 날만 읽기 (2026-10-25, 0.1.21 · 사용자 결정 안 A).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 기간 + 비교 → 필요한 날 수 판정표 (14→28 · 30→60 · 60→120, 비교 끔 = 기간)
 *    ② 이미 읽은 날은 다시 읽지 않는다 — 빠진(더 오래된) 날짜 키만 고른다. 문서가 없던 날도 「읽었음」
 *    ③ 실패한 읽기는 기억하지 않는다(다시 시도하면 같은 날을 읽는다) · 동시 요청은 겹쳐 읽지 않는다
 *    ④ 빈 팀은 빈 팀으로 — 0건이어도 목록에 남고, 지어낸 숫자가 없다
 *    ⑤ `#sai=` 페이로드가 사라졌다 — 사이드패널은 지표를 읽어 주소에 싣지 않고, 웹 예시는 주소를 읽지 않는다
 *    ⑥ `fetchFrictionDays` — 볼 수 없는 팀은 요청 없이 거절, 받은 날짜 키만 30개씩 batchGet
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { daysNeeded, recentKeys, missingKeys, coveredDays, INITIAL_DAYS, OTHER_TEAM_DAYS, MAX_DAYS } from '../src/dashboard/range.js';
import { createFrictionCache } from '../src/dashboard/frictionCache.js';
import { buildRows, isEmpty, splitWindow } from '../src/dashboard/seam/model.js';
import * as signals from '../src/dashboard/seam/signals.js';
import { dashboardPageUrl, DASHBOARD_PAGE } from '../src/lib/dashboardPage.js';
import { fetchFrictionDays, listViewableTeams, TEAM_ERRORS } from '../src/lib/teamClient.js';

const TODAY = new Date(2026, 9, 25);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ── ① 필요한 날 수 ── */

test('기간 + 비교 → 필요한 날 수 판정표', () => {
  assert.equal(daysNeeded(14, true), 28);
  assert.equal(daysNeeded(30, true), 60);
  assert.equal(daysNeeded(60, true), 120);
  assert.equal(daysNeeded(14, false), 14);
  assert.equal(daysNeeded(30, false), 30);
  assert.equal(daysNeeded(60, false), 60);
  assert.equal(daysNeeded(undefined, false), INITIAL_DAYS, '형식 밖이면 처음 읽기와 같다');
  assert.equal(daysNeeded(365, true), MAX_DAYS, '위로는 120일에서 자른다');
  assert.equal(INITIAL_DAYS, 30);
  assert.equal(OTHER_TEAM_DAYS, 30);
});

test('최근 N일 날짜 키 — 오래된 날 → 오늘, 달 경계를 넘는다', () => {
  const keys = recentKeys(30, TODAY);
  assert.equal(keys.length, 30);
  assert.equal(keys[29], '2026-10-25');
  assert.equal(keys[0], '2026-09-26');
});

/* ── ② 빠진 날만 ── */

test('🔴 30일을 읽은 뒤 「30일 + 비교」는 앞 30일만 더 읽는다', () => {
  const loaded = new Set(recentKeys(30, TODAY));
  assert.deepEqual(missingKeys(loaded, 30, TODAY), [], '이미 읽은 기간은 다시 읽지 않는다');
  const more = missingKeys(loaded, daysNeeded(30, true), TODAY);
  assert.equal(more.length, 30);
  assert.equal(more[0], '2026-08-27');
  assert.equal(more[29], '2026-09-25', '읽은 첫날(9/26) 바로 앞까지');
  assert.ok(more.every((k) => !loaded.has(k)));
});

test('끊기지 않고 읽은 날 수 — 중간이 비면 거기서 멈춘다(빠진 날을 0으로 지어내지 않는다)', () => {
  const keys = recentKeys(10, TODAY);
  assert.equal(coveredDays(new Set(keys), TODAY), 10);
  assert.equal(coveredDays(new Set(keys.filter((k) => k !== '2026-10-20')), TODAY), 5);
  assert.equal(coveredDays(new Set(), TODAY), 0);
});

function fakeFetch(docs = {}) {
  const calls = [];
  const fn = async (teamId, keys) => {
    calls.push({ teamId, keys: [...keys] });
    const out = {};
    for (const k of keys) if (docs[k]) out[k] = docs[k];
    return out;
  };
  return { fn, calls };
}

test('🔴 캐시 — 같은 날은 두 번 읽지 않는다 · 문서 없는 날도 읽은 것으로 친다', async () => {
  const { fn, calls } = fakeFetch({ '2026-10-25': { refined: 3 } });
  const cache = createFrictionCache({ fetchDays: fn, today: TODAY });
  await cache.ensure('t1', 30);
  await cache.ensure('t1', 30);
  await cache.ensure('t1', 14);
  assert.equal(calls.length, 1, '처음 30일 한 번뿐');
  assert.equal(calls[0].keys.length, 30);
  await cache.ensure('t1', 60); // 30일 + 비교
  await cache.ensure('t1', 120); // 60일 + 비교
  assert.deepEqual(calls.map((c) => c.keys.length), [30, 30, 60], '모자란 날만 더 읽는다');
  assert.equal(new Set(calls.flatMap((c) => c.keys)).size, 120, '겹친 날 없음');
  assert.equal(cache.stats.requestedDocs, 120);
  const snap = cache.snapshot('t1');
  assert.equal(snap.coverageDays, 120);
  assert.deepEqual(Object.keys(snap.byDate), ['2026-10-25'], '문서가 있던 날만 값이 있다');
});

test('캐시 — 팀마다 따로 센다', async () => {
  const { fn, calls } = fakeFetch();
  const cache = createFrictionCache({ fetchDays: fn, today: TODAY });
  await cache.ensure('a', 30);
  await cache.ensure('b', 30);
  await cache.ensure('a', 30);
  assert.deepEqual(calls.map((c) => c.teamId), ['a', 'b']);
});

/* ── ③ 실패 · 동시 ── */

test('🔴 실패한 읽기는 기억하지 않는다 — 다시 시도하면 같은 날을 읽는다', async () => {
  let fail = true;
  const calls = [];
  const cache = createFrictionCache({
    today: TODAY,
    fetchDays: async (id, keys) => {
      calls.push(keys.length);
      if (fail) throw new Error('network');
      return {};
    },
  });
  await assert.rejects(() => cache.ensure('t', 30));
  assert.equal(cache.snapshot('t').coverageDays, 0, '읽지 못한 날은 그리지 않는다');
  fail = false;
  await cache.ensure('t', 30);
  assert.deepEqual(calls, [30, 30]);
  assert.equal(cache.snapshot('t').coverageDays, 30);
});

test('동시에 두 번 불러도 겹쳐 읽지 않는다', async () => {
  const { fn, calls } = fakeFetch();
  const cache = createFrictionCache({ fetchDays: fn, today: TODAY });
  await Promise.all([cache.ensure('t', 30), cache.ensure('t', 60), cache.ensure('t', 30)]);
  assert.equal(new Set(calls.flatMap((c) => c.keys)).size, calls.flatMap((c) => c.keys).length);
  assert.equal(cache.snapshot('t').coverageDays, 60);
});

/* ── ④ 빈 팀 ── */

test('🔴 빈 팀은 빈 팀으로 — 신호 0건이어도 30일이 읽히고, 비교할 앞 기간을 지어내지 않는다', async () => {
  const cache = createFrictionCache({ fetchDays: async () => ({}), today: TODAY });
  await cache.ensure('empty', 30);
  const snap = cache.snapshot('empty');
  const rows = buildRows(snap.byDate, snap.coverageDays, TODAY);
  assert.equal(rows.length, 30);
  assert.ok(isEmpty(rows));
  assert.deepEqual(splitWindow(rows, 30).prev, []);
});

/* ── ⑤ `#sai=` 페이로드 제거 ── */

test('🔴 사이드패널은 지표를 읽어 주소에 싣지 않는다 — 확장 페이지를 팀 id 하나로 연다', () => {
  const src = read('src/sidepanel/App.jsx');
  assert.ok(!src.includes('fetchAllTeamsFriction'), '대시보드 열기 전에 모든 팀을 읽지 않는다');
  assert.ok(!src.includes('DASHBOARD_URL'), '웹 대시보드로 보내지 않는다');
  assert.ok(!/btoa\(/.test(src), '페이로드를 만들지 않는다');
  assert.ok(!/#sai=\$\{/.test(src));
  assert.ok(src.includes('dashboardPageUrl(team.teamId)'));
  const url = dashboardPageUrl('team 1', (p) => `chrome-extension://x/${p}`);
  assert.equal(url, 'chrome-extension://x/src/dashboard/index.html?team=team%201');
  assert.ok(!url.includes('#'));
  assert.equal(dashboardPageUrl(null, (p) => p), DASHBOARD_PAGE);
});

test('🔴 웹 예시는 주소의 #sai=를 읽지 않는다 — 파싱 함수도 없다', () => {
  assert.equal(signals.readLiveScenarios, undefined);
  assert.equal(signals.coverageDaysOf, undefined);
  const demo = read('dashboard/src/main.js');
  assert.ok(!demo.includes('atob'), '주소를 풀지 않는다');
  assert.ok(demo.includes('demo: true'));
  assert.ok(!read('site/index.html').includes("'/dashboard/' + location.hash"), '소개 사이트도 옛 주소의 데이터를 넘기지 않는다');
});

test('확장 빌드에 대시보드 페이지가 들어간다', () => {
  assert.ok(read('vite.config.js').includes("dashboard: 'src/dashboard/index.html'"));
  const html = read('src/dashboard/index.html');
  assert.ok(!/<script>(?!\s*<\/script>)/.test(html), '인라인 스크립트 없음 — 확장 CSP');
  assert.ok(!html.includes('cdn.jsdelivr'), '외부 서체 CDN 없음');
});

/* ── ⑥ fetchFrictionDays ── */

function installStorage(seed) {
  const store = { ...seed };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => { Object.assign(store, items); },
        remove: async (key) => { delete store[key]; },
      },
    },
    runtime: {},
    identity: {},
  };
  store['sai.auth'] = { idToken: 'id-token', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, email: 'a@b.c' };
  return store;
}

const TEAMS = [
  { teamId: 'own', name: '내 팀', role: 'owner' },
  { teamId: 'view', name: '열람 팀', role: 'member', canViewDashboard: true },
  { teamId: 'no', name: '못 보는 팀', role: 'member', canViewDashboard: false },
];

test('볼 수 있는 팀 — 팀장이거나 열람 권한을 받은 팀(사이드패널과 같은 판정)', async () => {
  installStorage({ 'sai.teams': TEAMS });
  assert.deepEqual((await listViewableTeams()).map((t) => t.teamId), ['own', 'view']);
});

test('🔴 fetchFrictionDays — 볼 수 없는 팀은 요청 없이 거절', async () => {
  installStorage({ 'sai.teams': TEAMS });
  let called = 0;
  await assert.rejects(
    () => fetchFrictionDays({ teamId: 'no', dateKeys: ['2026-10-25'], fetchImpl: async () => { called += 1; } }),
    (e) => e.reason === TEAM_ERRORS.NOT_A_MEMBER,
  );
  assert.equal(called, 0);
});

test('fetchFrictionDays — 받은 날짜 키만 30개씩 batchGet, 문서 있는 날만 숫자로 돌려준다 · 활성 팀은 그대로', async () => {
  const store = installStorage({ 'sai.teams': TEAMS, 'sai.teams.active': 'own' });
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body.documents);
    const rows = body.documents.map((name) => (name.endsWith('_2026-10-25')
      ? { found: { name, fields: { teamId: { stringValue: 'view' }, dateKey: { stringValue: '2026-10-25' }, refined: { integerValue: '4' }, misread: { integerValue: '1' } } } }
      : { missing: name }));
    return { ok: true, status: 200, json: async () => rows };
  };
  const keys = recentKeys(31, TODAY);
  const byDate = await fetchFrictionDays({ teamId: 'view', dateKeys: keys, fetchImpl });
  assert.deepEqual(bodies.map((b) => b.length), [30, 1]);
  assert.ok(bodies.flat().every((n) => n.includes('/frictionCounts/view_')));
  assert.deepEqual(byDate, { '2026-10-25': { refined: 4, misread: 1 } }, '문자열 필드(teamId·dateKey)는 빠진다');
  assert.equal(store['sai.teams.active'], 'own', '사이드패널이 보던 팀을 바꾸지 않는다');
});
