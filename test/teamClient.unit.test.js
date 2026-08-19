/**
 * 팀 클라이언트 — 업로드 정합성·용어집 우선순위·대시보드 페이로드 (Spec §3 / 2026-08-15).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 서버가 **반영했다고 응답한 만큼만** 로컬에서 뺀다 (부분 성공에서 카운트가 사라지지 않는다)
 *    ② 팀이 없으면 **아무것도 올라가지 않는다** (개인 사용자 보호)
 *    ③ 팀 용어는 `scope: 'team'`이라 개인 용어에 밀린다 (프롬프트 우선순위 계약)
 *    ④ 대시보드로 넘기는 값에 개인 식별자가 없다
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  uploadFriction,
  listTeams,
  getTeam,
  setActiveTeam,
  leaveTeam,
  joinTeam,
  toRefinePayloadTeamGlossary,
  teamErrorMessage,
  TEAM_ERRORS,
} from '../src/lib/teamClient.js';
import { recordFrictionEvent, takeFrictionBatch, FRICTION_EVENTS } from '../src/lib/friction.js';

function installStorage(seed = {}) {
  const store = { ...seed };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => {
          Object.assign(store, items);
        },
        remove: async (key) => {
          delete store[key];
        },
      },
    },
    runtime: {},
    identity: {},
  };
  return store;
}

const TEAM = { teamId: 't1', name: '사이 팀', role: 'member' };
const MON = new Date(2026, 7, 17, 10, 0);

/** `getIdToken`은 `STORAGE_KEYS.AUTH`(`sai.auth`)를 본다 — 세션을 심어 로그인 상태를 만든다. */
function signedIn(store) {
  store['sai.auth'] = {
    idToken: 'id-token',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
    email: 'a@b.c',
  };
}

test('🔴 팀이 없으면 아무것도 올리지 않는다 — 개인 사용자의 카운트는 나가지 않는다', async () => {
  const store = installStorage();
  signedIn(store);
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, { teamId: TEAM.teamId, now: MON });

  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({ accepted: [] }) };
  };
  const out = await uploadFriction({ fetchImpl });
  assert.equal(out.uploaded, 0);
  assert.equal(called, false, '팀이 없는데 네트워크를 탔다');
  // 카운트는 그대로 남아 있어야 한다.
  assert.equal((await takeFrictionBatch(TEAM.teamId))[0].counts.misread, 1);
});

test('올릴 것이 없으면 네트워크를 타지 않는다', async () => {
  const store = installStorage({ 'sai.team': TEAM });
  signedIn(store);
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({ accepted: [] }) };
  };
  assert.deepEqual(await uploadFriction({ fetchImpl }), { uploaded: 0 });
  assert.equal(called, false);
});

test('🔴 서버가 반영한 만큼만 로컬에서 뺀다 — 부분 성공에서 카운트가 사라지면 안 된다', async () => {
  const store = installStorage({ 'sai.team': TEAM });
  signedIn(store);
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, { teamId: TEAM.teamId, now: MON });
  await recordFrictionEvent(FRICTION_EVENTS.VENTING, { teamId: TEAM.teamId, now: new Date(2026, 7, 18, 10, 0) });

  // 서버가 하루치만 받아들였다고 응답한다.
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ accepted: [{ dateKey: '2026-08-17', counts: { misread: 1 } }] }),
  });

  const out = await uploadFriction({ fetchImpl });
  assert.equal(out.uploaded, 1);
  const left = await takeFrictionBatch(TEAM.teamId);
  assert.deepEqual(
    left.map((d) => d.dateKey),
    ['2026-08-18'],
    '반영되지 않은 날짜가 사라졌다',
  );
});

test('🔴 업로드가 실패하면 카운트를 남긴다 — 다음 기회에 다시 올라가야 한다', async () => {
  const store = installStorage({ 'sai.team': TEAM });
  signedIn(store);
  await recordFrictionEvent(FRICTION_EVENTS.CLEAR, { teamId: TEAM.teamId, now: MON });

  const fetchImpl = async () => {
    throw new Error('network down');
  };
  await assert.rejects(() => uploadFriction({ fetchImpl }), (e) => e.reason === TEAM_ERRORS.NETWORK);
  assert.equal((await takeFrictionBatch(TEAM.teamId))[0].counts.clear, 1);
});

test('🔴 보내는 본문에 정수·날짜·팀 id뿐이다 (Spec 필수 5)', async () => {
  const store = installStorage({ 'sai.team': TEAM });
  signedIn(store);
  await recordFrictionEvent(FRICTION_EVENTS.VENTING, { teamId: TEAM.teamId, now: MON });

  let sentBody = null;
  const fetchImpl = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ accepted: [] }) };
  };
  await uploadFriction({ fetchImpl });

  assert.deepEqual(Object.keys(sentBody).sort(), ['action', 'days', 'teamId']);
  for (const day of sentBody.days) {
    assert.match(day.dateKey, /^\d{4}-\d{2}-\d{2}$/);
    for (const value of Object.values(day.counts)) assert.equal(typeof value, 'number');
  }
});

/* ── 용어집 우선순위 ─────────────────────────────────────────────────── */

test('🔴 팀 용어는 scope가 team이다 — 개인 용어와 겹칠 때 지는 쪽임을 모델이 알아야 한다', () => {
  const payload = toRefinePayloadTeamGlossary([
    { id: 'g1', sourceText: '배포', targetText: 'rollout', keepSource: false },
  ]);
  assert.equal(payload[0].scope, 'team');
  assert.equal(payload[0].entryType, 'term');
  assert.equal(payload[0].targetText, 'rollout');
});

test('빈 targetText는 null이 된다 — 프롬프트가 「원문 유지」로 읽는 값이다', () => {
  const payload = toRefinePayloadTeamGlossary([{ id: 'g2', sourceText: '사이', targetText: '' }]);
  assert.equal(payload[0].targetText, null);
});

/* ── 화면 문구 ───────────────────────────────────────────────────────── */

test('🔴 틀린 코드 문구가 「없는 팀」과 「틀린 코드」를 구분하지 않는다 — 탐색 도구가 되면 안 된다', () => {
  const message = teamErrorMessage(TEAM_ERRORS.BAD_CODE);
  assert.ok(!/없는 팀|존재하지/.test(message), `구분해 말하고 있다: ${message}`);
});

test('모든 사유에 사람이 읽을 문구가 있다', () => {
  for (const reason of Object.values(TEAM_ERRORS)) {
    assert.equal(typeof teamErrorMessage(reason), 'string');
    assert.notEqual(teamErrorMessage(reason).trim(), '');
  }
});

/* ── 다중 팀 (2026-08-16) ─────────────────────────────────────────────── */

test('🔴 예전 단일 팀이 목록으로 이관된다 — 업데이트로 팀을 잃으면 초대 코드가 없어 복구 불가다', async () => {
  const store = installStorage({ 'sai.team': TEAM });
  const teams = await listTeams();
  assert.deepEqual(
    teams.map((t) => t.teamId),
    ['t1'],
  );
  assert.equal((await getTeam()).teamId, 't1');
  // 🔴 옛 키는 남긴다 — 이관이 잘못됐을 때 되돌아갈 자리가 필요하다.
  assert.ok(store['sai.team']);
});

test('활성 팀을 바꾸면 그 팀이 보인다', async () => {
  installStorage({
    'sai.teams': [TEAM, { teamId: 't2', name: '두번째 팀', role: 'member' }],
    'sai.teams.active': 't1',
  });
  await setActiveTeam('t2');
  assert.equal((await getTeam()).teamId, 't2');
});

test('🔴 활성 id가 목록에 없으면 첫 팀으로 되돌린다 — "팀 없음" 화면이 뜨면 안 된다', async () => {
  installStorage({ 'sai.teams': [TEAM], 'sai.teams.active': '사라진팀' });
  assert.equal((await getTeam()).teamId, 't1');
});

test('연결을 끊으면 그 팀만 빠지고 나머지는 남는다', async () => {
  installStorage({
    'sai.teams': [TEAM, { teamId: 't2', name: '두번째 팀', role: 'owner' }],
    'sai.teams.active': 't1',
  });
  await leaveTeam('t1');
  const left = await listTeams();
  assert.deepEqual(
    left.map((t) => t.teamId),
    ['t2'],
  );
  assert.equal((await getTeam()).teamId, 't2', '활성 팀이 남은 팀으로 옮겨져야 한다');
});

test('팀이 하나도 없으면 null이다', async () => {
  installStorage();
  assert.equal(await getTeam(), null);
  assert.deepEqual(await listTeams(), []);
});

test('🔴 참가 시 이름·직급이 함께 실려 나간다 — 팀장이 사람을 알아봐야 권한을 준다', async () => {
  const store = installStorage();
  signedIn(store);
  let sent = null;
  const fetchImpl = async (_url, options) => {
    sent = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ teamId: 't9', name: '새 팀', role: 'member', canViewDashboard: false }),
    };
  };
  await joinTeam('ABC123', { displayName: '박수홍', jobTitle: '백엔드 리드' }, { fetchImpl });
  assert.equal(sent.displayName, '박수홍');
  assert.equal(sent.jobTitle, '백엔드 리드');
});
