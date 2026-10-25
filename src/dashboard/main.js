/**
 * 확장 안 팀 대시보드 — `chrome-extension://<id>/src/dashboard/index.html[?team=<teamId>]` (2026-10-25, 0.1.21).
 *
 * 🔴 왜 확장 페이지인가 (사용자 결정 2026-10-25, 안 A): 예전 웹 대시보드는 로그인이 없어 사이드패널이
 *    120일 × 모든 팀을 미리 읽어 주소(`#sai=`)에 실어 보냈다 — 열 때마다 팀당 120회 읽기, 팀 합계가 URL·방문 기록에
 *    남았다. 여기서는 확장의 로그인으로 **필요한 팀·필요한 날만** 직접 읽는다.
 *
 * 판정표 — 상태 판(`#gate`)
 * | 조건 | 화면 |
 * |---|---|
 * | 로그인 안 됨 | 「로그인이 필요해요」 + 로그인 · 다시 확인 |
 * | 소속 팀 0개 | 「아직 팀이 없어요」 — 사이드패널 → 팀에서 만들거나 참가 |
 * | 팀은 있는데 볼 수 있는 팀 0개 | 「볼 수 있는 팀이 없어요」 — 팀장에게 열람 권한 요청 |
 * | 첫 읽기 실패(네트워크·권한) | 그 사유 한 줄 + 다시 시도 |
 * | 빈 팀(신호 0건) | Seam 자체의 「아직 쌓인 신호가 없어요」 |
 * 🔴 지어낸 숫자를 그리지 않는다 — 읽지 못한 날은 그리지 않고, 비교할 자료가 없으면 그렇다고 말한다.
 * 🔴 팀 단위 정수 합계만 읽는다(Zero Retention · 사람 단위 값 없음). 읽은 값은 이 탭의 메모리에만 있다.
 */

import '../styles/fonts.css';
import './seam/seam.css';
import './dashboard.css';
import { mountSeamMarkup } from './seam/markup.js';
import { buildRows } from './seam/model.js';
import { mount } from './seam/app.js';
import { createFrictionCache } from './frictionCache.js';
import { INITIAL_DAYS, OTHER_TEAM_DAYS } from './range.js';
import { getSession, signIn, isAuthConfigured, authErrorMessage, AuthError } from '../lib/authClient.js';
import {
  listTeams,
  listViewableTeams,
  getTeam,
  fetchFrictionDays,
  teamErrorMessage,
  TeamClientError,
  TEAM_ERRORS,
} from '../lib/teamClient.js';
import { readDisplaySettings, writeDisplaySetting } from '../lib/displaySettings.js';
import { STORAGE_KEYS } from '../lib/storage.js';

/** 실데이터에는 상대 쪽 이름이 없다 — 지어내지 않고 이렇게 부른다(웹 대시보드 시절과 같은 말). */
export const OTHER_SIDE = '주고받은 동료들';

const $ = (id) => document.getElementById(id);
const today = new Date();
let mounted = false;

mountSeamMarkup($('seam'));

/* ── 밝기: 확장 설정(`sai.theme`)을 따르고, 사이드패널·설정 페이지에서 바꾸면 따라간다 ── */
function applyTheme(value) {
  document.documentElement.dataset.theme = value === 'dark' ? 'dark' : 'light';
}
readDisplaySettings().then((d) => applyTheme(d.theme)).catch(() => applyTheme('light'));

/* ── 읽기 실패를 사람 말로 ── */
export function errorText(error) {
  if (error instanceof AuthError) return '로그인이 만료됐어요 — 다시 로그인한 뒤 「다시 시도」를 눌러 주세요';
  if (error instanceof TeamClientError) {
    if (error.reason === TEAM_ERRORS.NOT_A_MEMBER) return '이 팀의 지표를 볼 권한이 없어요 — 팀장에게 대시보드 열람을 요청해 주세요';
    if (error.reason === TEAM_ERRORS.NETWORK || error.reason === TEAM_ERRORS.NOT_SIGNED_IN) return teamErrorMessage(error.reason);
  }
  return '팀 지표를 불러오지 못했어요 — 잠시 뒤 다시 시도해 주세요';
}

/* ── 상태 판 ── */
function showGate({ title, body, actions = [] }) {
  $('gate').hidden = false;
  $('board').hidden = true;
  $('team').hidden = true;
  $('theme').hidden = true;
  $('gate-h').textContent = title;
  $('gate-p').textContent = body;
  const box = $('gate-acts');
  box.replaceChildren();
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = a.primary ? 'gate-btn primary' : 'gate-btn';
    btn.textContent = a.label;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await a.run(); } finally { btn.disabled = false; }
    });
    box.appendChild(btn);
  }
}

function hideGate() {
  $('gate').hidden = true;
  $('board').hidden = false;
  $('team').hidden = false;
  $('theme').hidden = false;
}

const recheck = { label: '다시 확인', run: () => boot() };

async function doSignIn() {
  try {
    await signIn();
    await boot();
  } catch (error) {
    $('gate-p').textContent = authErrorMessage(error?.reason, error?.detail);
  }
}

/* ── 시작 — 🔴 로그인 직후 저장소 변경과 버튼이 겹쳐도 한 번만 돈다 ── */
let booting = null;
function boot() {
  if (!booting) booting = run().finally(() => { booting = null; });
  return booting;
}

async function run() {
  if (mounted) return;
  const session = await getSession().catch(() => null);
  if (!session) {
    showGate({
      title: '로그인이 필요해요',
      body: '팀 대시보드는 사이 계정으로 로그인해야 볼 수 있어요. 여기서 로그인하거나, 사이드패널 → 설정(톱니) → 계정에서 로그인한 뒤 「다시 확인」을 눌러 주세요.',
      actions: [...(isAuthConfigured() ? [{ label: '구글로 로그인', primary: true, run: doSignIn }] : []), recheck],
    });
    return;
  }

  const all = await listTeams();
  const viewable = await listViewableTeams();
  if (all.length === 0) {
    showGate({
      title: '아직 팀이 없어요',
      body: '사이드패널 → 팀에서 팀을 만들거나 초대 코드로 참가하면, 그 팀의 협업 건강도가 여기에 쌓여요.',
      actions: [recheck],
    });
    return;
  }
  if (viewable.length === 0) {
    showGate({
      title: '볼 수 있는 팀이 없어요',
      body: '소속된 팀은 있지만 대시보드 열람 권한이 없어요. 팀장이 사이드패널 → 팀 → 팀원 목록에서 열람을 켜 주면 여기에 나와요.',
      actions: [recheck],
    });
    return;
  }

  // 처음 고를 팀 — 주소의 `?team=` → 사이드패널이 보던 팀 → 첫 팀. 🔴 볼 수 없는 팀 id는 무시한다.
  const wanted = new URLSearchParams(location.search).get('team');
  const active = await getTeam().catch(() => null);
  let initial = viewable.findIndex((t) => t.teamId === wanted);
  if (initial < 0) initial = viewable.findIndex((t) => t.teamId === active?.teamId);
  if (initial < 0) initial = 0;

  const cache = createFrictionCache({
    fetchDays: (teamId, dateKeys) => fetchFrictionDays({ teamId, dateKeys }),
    today,
  });
  const load = async (i, days) => {
    const id = viewable[i].teamId;
    await cache.ensure(id, days);
    const snap = cache.snapshot(id);
    return { rows: buildRows(snap.byDate, snap.coverageDays, today), coverageDays: snap.coverageDays };
  };

  showGate({ title: '팀 지표를 불러오는 중이에요', body: `${viewable[initial].name || '이름 없는 팀'} · 최근 ${INITIAL_DAYS}일` });
  const teams = viewable.map((t) => ({ id: t.teamId, a: t.name || '이름 없는 팀', b: OTHER_SIDE, rows: [], coverageDays: 0, status: 'idle' }));
  try {
    Object.assign(teams[initial], await load(initial, INITIAL_DAYS), { status: 'ready' });
  } catch (error) {
    showGate({ title: '팀 지표를 불러오지 못했어요', body: errorText(error), actions: [{ label: '다시 시도', primary: true, run: () => boot() }] });
    return;
  }

  hideGate();
  mounted = true;
  mount(teams, {
    demo: false,
    load,
    initial,
    otherDays: OTHER_TEAM_DAYS,
    errorText,
    saveTheme: (next) => { writeDisplaySetting('theme', next).catch(() => {}); },
    sourceLine: '사이 Team Health · 로그인한 계정으로 이 탭이 직접 읽은 팀 합계',
  });
}

if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEYS.THEME]) applyTheme(changes[STORAGE_KEYS.THEME].newValue);
    // 상태 판이 떠 있는 동안 사이드패널에서 로그인·팀 참가를 하면 바로 다시 본다.
    if (!mounted && (changes[STORAGE_KEYS.AUTH] || changes[STORAGE_KEYS.TEAMS])) boot();
  });
}

boot();
