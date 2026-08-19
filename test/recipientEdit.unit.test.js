/**
 * 수신자 편집 · 팀 역할 재동기화 (2026-08-16 사용자 요청 ③⑦).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 편집 경로가 **추가 경로와 같은 검증**을 건다 — 「추가할 땐 못 넣는데 고치면 들어가는」
 *       구멍을 막는다. `language`는 프롬프트의 `targetLanguage`로 그대로 나가는 값이다.
 *    ② 편집이 **태그를 지우지 않는다** — 폼에 없는 필드를 건드리면 붙여 둔 태그가 날아간다.
 *    ③ `refreshAllMemberships`가 **모든 팀의 역할을 제자리에서** 고친다 — 순서도 활성 팀도
 *       바뀌지 않는다. 팀장을 넘겨받고도 계속 팀원으로 보이던 증상의 원인이 여기였다.
 *    ④ 서버에 못 닿은 팀은 **옛 값을 유지한다** — 네트워크 문제로 소속이 사라지면 사용자는
 *       팀에 다시 참가하려 들고, 그 초대 코드는 우리가 저장하지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

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

/* ── ③ 편집 ──────────────────────────────────────────────────────────── */

test('🔴 편집도 추가와 같은 언어 검증을 건다 — 지원 밖 언어는 버린다', async () => {
  installStorage();
  const { addRecipient, updateRecipient, listRecipients } = await import(
    '../src/lib/recipients.js'
  );

  const created = await addRecipient({
    name: '홍길동',
    timeZone: 'Europe/Berlin',
    countryCode: 'de',
    language: 'de',
    tagIds: ['prefers-direct'],
  });
  assert.equal(created.language, 'de');
  assert.equal(created.countryCode, 'DE', '국가코드가 대문자로 정규화되지 않았다');

  // 🔴 지원하지 않는 언어(포르투갈어)를 편집으로 밀어 넣어도 통과하면 안 된다.
  const patched = await updateRecipient(created.id, { language: 'pt' });
  assert.equal(patched.language, null, '지원 밖 언어가 편집으로 들어갔다');

  const [stored] = await listRecipients();
  assert.equal(stored.language, null);
});

test('🔴 편집이 태그를 지우지 않는다', async () => {
  installStorage();
  const { addRecipient, updateRecipient } = await import('../src/lib/recipients.js');

  const created = await addRecipient({
    name: '홍길동',
    timeZone: 'Asia/Seoul',
    tagIds: ['prefers-direct', 'prefers-short'],
  });

  const patched = await updateRecipient(created.id, {
    name: '홍길순',
    timeZone: 'Asia/Tokyo',
    language: 'ja',
  });
  assert.deepEqual(
    patched.tagIds,
    ['prefers-direct', 'prefers-short'],
    '이름·지역만 고쳤는데 태그가 사라졌다',
  );
  assert.equal(patched.name, '홍길순');
  assert.equal(patched.timeZone, 'Asia/Tokyo');
});

test('🔴 편집으로 빈 이름·빈 지역을 만들 수 없다', async () => {
  installStorage();
  const { addRecipient, updateRecipient } = await import('../src/lib/recipients.js');
  const created = await addRecipient({ name: '홍길동', timeZone: 'Asia/Seoul' });

  await assert.rejects(() => updateRecipient(created.id, { name: '   ' }));
  await assert.rejects(() => updateRecipient(created.id, { timeZone: '' }));
});

test('빈 teamId 문자열은 null로 정규화된다 — 없는 팀 용어집을 찾지 않는다', async () => {
  installStorage();
  const { addRecipient, updateRecipient } = await import('../src/lib/recipients.js');
  const created = await addRecipient({ name: '홍길동', timeZone: 'Asia/Seoul', teamId: 'tm-1' });
  assert.equal(created.teamId, 'tm-1');

  const patched = await updateRecipient(created.id, { teamId: '  ' });
  assert.equal(patched.teamId, null);
});

/* ── ④ 지역이 언어를 채운다 ───────────────────────────────────────────── */

test('🔴 모든 지역의 language가 수신자 지원 언어 안에 있다', async () => {
  const { REGIONS } = await import('../src/lib/regions.js');
  const { RECIPIENT_LANGUAGES } = await import('../src/lib/recipients.js');
  for (const region of REGIONS) {
    assert.ok(
      RECIPIENT_LANGUAGES.includes(region.language),
      `${region.id}의 기본 언어 ${region.language}는 고를 수 없는 값이다`,
    );
  }
});

/* ── ⑦ 팀 역할 재동기화 ──────────────────────────────────────────────── */

const TEAMS_KEY = 'sai.teams';
const ACTIVE_KEY = 'sai.teams.active';

/** `me` 응답을 uid별로 흉내 낸다. `null`이면 그 팀만 실패시킨다. */
function fakeFetch(byTeam) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const answer = byTeam[body.teamId];
    if (!answer) return { ok: false, json: async () => ({ error: 'network-failed' }) };
    return { ok: true, json: async () => answer };
  };
}

async function loadTeamClient() {
  // 🔴 토큰 조회를 막지 않으면 네트워크를 탄다 — 이 테스트가 보는 것은 저장 결과뿐이다.
  const mod = await import('../src/lib/teamClient.js');
  return mod;
}

test('🔴 팀장을 넘겨받으면 로컬 역할이 owner로 바뀐다', async () => {
  const store = installStorage({
    [TEAMS_KEY]: [
      { teamId: 'a', name: 'A', role: 'member', canViewDashboard: false },
      { teamId: 'b', name: 'B', role: 'member', canViewDashboard: false },
    ],
    [ACTIVE_KEY]: 'a',
    'sai.auth': { idToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3600_000 },
  });
  const { refreshAllMemberships } = await loadTeamClient();

  const result = await refreshAllMemberships({
    fetchImpl: fakeFetch({
      a: { role: 'owner', canViewDashboard: true },
      b: { role: 'member', canViewDashboard: false },
    }),
  });

  assert.equal(result.changed, true);
  assert.equal(store[TEAMS_KEY][0].role, 'owner', '넘겨받은 팀장 역할이 반영되지 않았다');
  assert.equal(store[TEAMS_KEY][0].canViewDashboard, true);
});

test('🔴 순서도 활성 팀도 바뀌지 않는다 — 갱신이 팀을 갈아치우면 안 된다', async () => {
  const store = installStorage({
    [TEAMS_KEY]: [
      { teamId: 'a', name: 'A', role: 'member', canViewDashboard: false },
      { teamId: 'b', name: 'B', role: 'member', canViewDashboard: false },
      { teamId: 'c', name: 'C', role: 'member', canViewDashboard: false },
    ],
    [ACTIVE_KEY]: 'a',
    'sai.auth': { idToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3600_000 },
  });
  const { refreshAllMemberships } = await loadTeamClient();

  await refreshAllMemberships({
    fetchImpl: fakeFetch({
      a: { role: 'member', canViewDashboard: true },
      b: { role: 'owner', canViewDashboard: true },
      c: { role: 'member', canViewDashboard: false },
    }),
  });

  assert.deepEqual(
    store[TEAMS_KEY].map((t) => t.teamId),
    ['a', 'b', 'c'],
    '갱신이 팀 순서를 바꿨다',
  );
  assert.equal(store[ACTIVE_KEY], 'a', '갱신이 활성 팀을 옮겼다');
});

test('🔴 서버에 못 닿은 팀은 옛 값을 유지한다 — 소속이 사라지면 복구 경로가 없다', async () => {
  const store = installStorage({
    [TEAMS_KEY]: [
      { teamId: 'a', name: 'A', role: 'owner', canViewDashboard: true },
      { teamId: 'b', name: 'B', role: 'member', canViewDashboard: true },
    ],
    [ACTIVE_KEY]: 'a',
    'sai.auth': { idToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3600_000 },
  });
  const { refreshAllMemberships } = await loadTeamClient();

  // a만 응답하고 b는 실패한다.
  await refreshAllMemberships({
    fetchImpl: fakeFetch({ a: { role: 'owner', canViewDashboard: true } }),
  });

  assert.equal(store[TEAMS_KEY].length, 2, '실패한 팀이 목록에서 사라졌다');
  assert.equal(store[TEAMS_KEY][1].role, 'member');
  assert.equal(store[TEAMS_KEY][1].canViewDashboard, true, '실패가 권한을 꺼 버렸다');
});

test('🔴 바뀐 게 없으면 저장하지 않는다', async () => {
  const store = installStorage({
    [TEAMS_KEY]: [{ teamId: 'a', name: 'A', role: 'owner', canViewDashboard: true }],
    [ACTIVE_KEY]: 'a',
    'sai.auth': { idToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3600_000 },
  });
  const before = store[TEAMS_KEY];
  const { refreshAllMemberships } = await loadTeamClient();

  const result = await refreshAllMemberships({
    fetchImpl: fakeFetch({ a: { role: 'owner', canViewDashboard: true } }),
  });

  assert.equal(result.changed, false);
  assert.equal(store[TEAMS_KEY], before, '변화가 없는데 새 배열로 덮어썼다');
});
