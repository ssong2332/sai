/**
 * 팀 나가기·계정 삭제 (L22-②③ — 2026-09-30).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 판정표(`functions/account.js` 헤더) 그대로 — 팀장+다른 팀원이면 막고, 혼자면 팀째 지운다
 *    ② 계정 삭제는 **막히면 하나도 지우지 않는다**, 막히지 않으면 **로그인 계정을 맨 마지막**에 지운다
 *    ③ 확인값(`confirm: "DELETE"`) 없이는 지우지 않는다
 *    ④ 어댑터가 **남의 데이터를 지우지 않는다** — 다른 팀 지표·다른 사람 카운터는 그대로
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planLeave,
  planAccountDeletion,
  leaveTeamOnServer,
  deleteAccount,
  accountStore,
} from '../functions/account.js';
import { TeamError } from '../functions/teams.js';

const req = (body, token = 'tok') => ({ body, get: () => (token ? 'Bearer ' + token : '') });

/** 어댑터 대역 — 호출 순서만 기록한다. */
function fakeStore(memberships = []) {
  const calls = [];
  return {
    calls,
    membership: async (teamId) => memberships.find((m) => m.teamId === teamId) ?? null,
    memberships: async () => memberships,
    deleteMember: async (teamId) => calls.push(`member:${teamId}`),
    deleteTeam: async (teamId) => calls.push(`team:${teamId}`),
    deleteUserData: async () => calls.push('user'),
    deleteAuthUser: async () => calls.push('auth'),
  };
}

const deps = (store, uid = 'u1') => ({
  verifyIdToken: async () => ({ uid }),
  accountStore: () => store,
});

const member = (teamId) => ({ teamId, isOwner: false, memberCount: 3 });
const ownerWithOthers = (teamId) => ({ teamId, isOwner: true, memberCount: 2 });
const ownerAlone = (teamId) => ({ teamId, isOwner: true, memberCount: 1 });

/* ── 판정표 ─────────────────────────────────────────────────────────── */

test('판정표 — 팀원은 나가고, 혼자인 팀장은 팀을 지우고, 다른 팀원이 있는 팀장은 막힌다', () => {
  assert.equal(planLeave(member('t')), 'leave');
  assert.equal(planLeave(ownerAlone('t')), 'delete-team');
  assert.equal(planLeave(ownerWithOthers('t')), 'blocked');
});

test('판정표 — 소속이 아니면 403', () => {
  assert.throws(() => planLeave(null), (e) => e instanceof TeamError && e.status === 403);
});

test('계정 삭제 판정은 소속별로 나눈다', () => {
  assert.deepEqual(planAccountDeletion([member('a'), ownerAlone('b'), ownerWithOthers('c')]), {
    blocked: ['c'],
    deleteTeams: ['b'],
    leaveTeams: ['a'],
  });
});

/* ── 팀 나가기 ─────────────────────────────────────────────────────── */

test('🔴 팀장 + 다른 팀원 → 409, 아무것도 지우지 않는다', async () => {
  const store = fakeStore([ownerWithOthers('t1')]);
  await assert.rejects(
    () => leaveTeamOnServer(req({ teamId: 't1' }), deps(store)),
    (e) => e.status === 409 && e.reason === 'owner-must-transfer',
  );
  assert.deepEqual(store.calls, []);
});

test('팀원이 나가면 내 명부 문서만 지운다', async () => {
  const store = fakeStore([member('t1')]);
  const result = await leaveTeamOnServer(req({ teamId: 't1' }), deps(store));
  assert.deepEqual(store.calls, ['member:t1']);
  assert.deepEqual(result, { teamId: 't1', left: true, teamDeleted: false });
});

test('혼자인 팀장이 나가면 팀을 통째로 지운다', async () => {
  const store = fakeStore([ownerAlone('t1')]);
  const result = await leaveTeamOnServer(req({ teamId: 't1' }), deps(store));
  assert.deepEqual(store.calls, ['team:t1']);
  assert.equal(result.teamDeleted, true);
});

test('🔴 토큰이 없으면 401 — 남의 이름으로 나갈 수 없다', async () => {
  await assert.rejects(
    () => leaveTeamOnServer(req({ teamId: 't1' }, ''), deps(fakeStore([member('t1')]))),
    (e) => e.status === 401,
  );
});

/* ── 계정 삭제 ─────────────────────────────────────────────────────── */

test('🔴 확인값 없이는 지우지 않는다', async () => {
  const store = fakeStore([]);
  await assert.rejects(
    () => deleteAccount(req({}), deps(store)),
    (e) => e.status === 400 && e.reason === 'not-confirmed',
  );
  assert.deepEqual(store.calls, []);
});

test('🔴 팀장인 팀에 다른 팀원이 하나라도 있으면 **전부** 거절한다 — 반쯤 지우지 않는다', async () => {
  const store = fakeStore([member('a'), ownerAlone('b'), ownerWithOthers('c')]);
  await assert.rejects(
    () => deleteAccount(req({ confirm: 'DELETE' }), deps(store)),
    (e) => e.status === 409 && e.reason === 'owner-must-transfer',
  );
  assert.deepEqual(store.calls, [], '막혔는데 무언가 지웠다');
});

test('🔴 계정 삭제 순서 — 팀 정리 → 내 데이터 → 로그인 계정(맨 마지막)', async () => {
  const store = fakeStore([member('a'), ownerAlone('b')]);
  const result = await deleteAccount(req({ confirm: 'DELETE' }), deps(store));
  assert.deepEqual(store.calls, ['member:a', 'team:b', 'user', 'auth']);
  assert.deepEqual(result, { deleted: true, leftTeams: 1, deletedTeams: 1 });
});

test('응답에 이메일·이름이 없다 — 건수뿐이다', async () => {
  const result = await deleteAccount(req({ confirm: 'DELETE' }), deps(fakeStore([])));
  assert.deepEqual(Object.keys(result).sort(), ['deleted', 'deletedTeams', 'leftTeams']);
});

/* ── Admin SDK 어댑터 (가짜 Firestore) ──────────────────────────────── */

/** `accountStore`가 쓰는 Admin API만 흉내 낸다. 경로 → 데이터. */
function fakeAdminDb(seed) {
  const docs = new Map(Object.entries(seed));
  const childrenOf = (path) =>
    [...docs.keys()].filter((key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'));

  const snapOf = (path) => ({
    exists: docs.has(path),
    get: (field) => docs.get(path)?.[field],
    ref: docRef(path),
  });
  const query = (path, filter, max = Infinity) => ({
    limit: (n) => query(path, filter, n),
    get: async () => {
      const hits = childrenOf(path)
        .filter((key) => !filter || docs.get(key)[filter.field] === filter.value)
        .slice(0, max);
      return { empty: hits.length === 0, size: hits.length, docs: hits.map(snapOf) };
    },
  });
  function collection(path) {
    return {
      doc: (id) => docRef(`${path}/${id}`),
      where: (field, _op, value) => query(path, { field, value }),
      limit: (n) => query(path, null, n),
      listDocuments: async () => {
        const ids = new Set(
          [...docs.keys()].filter((key) => key.startsWith(path + '/')).map((key) => key.slice(path.length + 1).split('/')[0]),
        );
        return [...ids].map((id) => docRef(`${path}/${id}`));
      },
    };
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(),
      path,
      get: async () => snapOf(path),
      delete: async () => docs.delete(path),
      collection: (name) => collection(`${path}/${name}`),
    };
  }
  return {
    docs,
    collection,
    getAll: (...refs) => Promise.all(refs.map((ref) => ref.get())),
    recursiveDelete: async (ref) => {
      for (const key of [...docs.keys()]) if (key === ref.path || key.startsWith(ref.path + '/')) docs.delete(key);
    },
    batch: () => {
      const pending = [];
      return { delete: (ref) => pending.push(ref), commit: async () => pending.forEach((ref) => docs.delete(ref.path)) };
    },
  };
}

const SEED = {
  'teams/mine': { ownerUid: 'u1', name: '내 팀' },
  'teams/mine/members/u1': { role: 'owner', email: 'u1@x.com' },
  'teams/mine/glossary/g1': { sourceText: 'PR' },
  'teams/shared': { ownerUid: 'boss', name: '같이 쓰는 팀' },
  'teams/shared/members/boss': { role: 'owner' },
  'teams/shared/members/u1': { role: 'member', email: 'u1@x.com', jobTitle: '개발' },
  'teams/shared/glossary/g2': { sourceText: 'LGTM' },
  'frictionCounts/mine_2026-09-01': { teamId: 'mine', venting: 1 },
  'frictionCounts/shared_2026-09-01': { teamId: 'shared', venting: 2 },
  'users/u1': { language: 'ko' },
  'users/u1/learnedPatterns/fewer-apologies': { kind: 'fewer-apologies', count: 3 },
  'users/u1/glossary/e1': { sourceText: '배포' },
  'users/u2': { language: 'en' },
  'refineQuota/u1_2026-09-29': { uid: 'u1', count: 4 },
  'refineQuota/u2_2026-09-29': { uid: 'u2', count: 9 },
};

test('어댑터 — 소속을 찾고 팀장 여부·인원을 판정한다', async () => {
  const store = accountStore(fakeAdminDb(SEED), { deleteUser: async () => {} });
  const found = (await store.memberships('u1')).sort((a, b) => a.teamId.localeCompare(b.teamId));
  assert.deepEqual(found, [
    { teamId: 'mine', isOwner: true, memberCount: 1 },
    { teamId: 'shared', isOwner: false, memberCount: 2 },
  ]);
});

test('🔴 어댑터 — 명부 role이 강등돼 있어도 ownerUid가 나면 팀장이다', async () => {
  const db = fakeAdminDb({ ...SEED, 'teams/mine/members/u1': { role: 'member' } });
  const store = accountStore(db, { deleteUser: async () => {} });
  assert.equal((await store.membership('mine', 'u1')).isOwner, true);
});

test('🔴 어댑터 — 계정 삭제 전 과정이 내 것만 지우고 남의 것은 남긴다', async () => {
  const db = fakeAdminDb(SEED);
  const deletedAuth = [];
  const store = accountStore(db, { deleteUser: async (uid) => deletedAuth.push(uid) });
  await deleteAccount(req({ confirm: 'DELETE' }), { verifyIdToken: async () => ({ uid: 'u1' }), accountStore: () => store });

  const left = [...db.docs.keys()].sort();
  assert.deepEqual(left, [
    'frictionCounts/shared_2026-09-01',
    'refineQuota/u2_2026-09-29',
    'teams/shared',
    'teams/shared/glossary/g2',
    'teams/shared/members/boss',
    'users/u2',
  ]);
  assert.deepEqual(deletedAuth, ['u1']);
});

test('어댑터 — 로그인 계정이 이미 없으면 성공으로 본다(멱등)', async () => {
  const gone = Object.assign(new Error('x'), { code: 'auth/user-not-found' });
  const store = accountStore(fakeAdminDb({}), { deleteUser: async () => { throw gone; } });
  await store.deleteAuthUser('u1');
});

test('어댑터 — 다른 Auth 오류는 삼키지 않는다', async () => {
  const boom = Object.assign(new Error('x'), { code: 'auth/internal-error' });
  const store = accountStore(fakeAdminDb({}), { deleteUser: async () => { throw boom; } });
  await assert.rejects(() => store.deleteAuthUser('u1'));
});
