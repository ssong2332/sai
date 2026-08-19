/**
 * 팀 생성·참가·마찰 적재 (Spec §3 / 2026-08-15).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 남의 팀에 카운트를 못 넣는다 (팀원 확인)
 *    ② 초대 코드가 응답으로 새어 나가지 않는다
 *    ③ 화이트리스트 밖 필드(=본문이 들어올 자리)가 Firestore에 도달하지 않는다
 *    ④ 개인 식별자(uid)가 마찰 문서에 남지 않는다
 *
 * 🔴 Firestore/Auth를 전부 대역으로 바꿔 **네트워크 없이** 돈다 — `teams.js`가 판정을 전부
 *    들고 있고 `index.js`는 라우팅만 하므로 가능한 구조다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTeam, joinTeam, recordFriction, TeamError } from '../functions/teams.js';

/**
 * 아주 얇은 Firestore 대역 — 이 테스트가 쓰는 경로만 구현한다.
 * 🔴 `FieldValue.increment()`는 실제 Admin SDK 객체라 값이 그대로 기록된다. 우리가 확인하려는
 *    것은 "무엇이 쓰였는가"(필드 이름·merge 여부)이지 증가 연산의 결과가 아니다.
 */
function fakeDb() {
  const docs = new Map(); // path -> data
  const writes = []; // {path, data, merge}

  const makeDoc = (path) => ({
    id: path.split('/').pop(),
    get ref() {
      return makeDoc(path);
    },
    get: async () => ({
      exists: docs.has(path),
      id: path.split('/').pop(),
      get: (field) => docs.get(path)?.[field],
    }),
    set: async (data, options) => {
      writes.push({ path, data, merge: !!options?.merge });
      docs.set(path, { ...(docs.get(path) ?? {}), ...data });
    },
    collection: (name) => makeCollection(path + '/' + name),
  });

  const makeCollection = (path) => ({
    doc: (id) => makeDoc(path + '/' + (id ?? 'auto-' + docs.size)),
    where: (field, _op, value) => ({
      limit: () => ({
        get: async () => {
          const hits = [...docs.entries()].filter(
            ([key, data]) => key.startsWith(path + '/') && data[field] === value,
          );
          return {
            empty: hits.length === 0,
            docs: hits.map(([key, data]) => ({
              id: key.split('/').pop(),
              ref: makeDoc(key),
              get: (f) => data[f],
            })),
          };
        },
      }),
    }),
  });

  return {
    docs,
    writes,
    collection: makeCollection,
    runTransaction: async (fn) =>
      fn({
        get: (query) => query.get(),
        set: (ref, data) => ref.set(data),
      }),
    batch: () => ({
      set: (ref, data, options) => ref.set(data, options),
      commit: async () => {},
    }),
  };
}

function deps(db, options = {}) {
  const uid = options.uid ?? 'u1';
  let n = 0;
  return {
    db: () => db,
    verifyIdToken: async () => {
      if (options.throwOnToken) throw new Error('bad');
      return { uid };
    },
    // 결정적인 코드 — 테스트가 흔들리지 않게 한다.
    randomInt: () => {
      n += 1;
      return n % 31;
    },
  };
}

const req = (body, token = 'tok') => ({
  body,
  get: () => (token ? 'Bearer ' + token : ''),
});

/* ── 인증 ────────────────────────────────────────────────────────────── */

test('🔴 토큰이 없으면 401 — 익명으로 팀을 만들 수 없다', async () => {
  await assert.rejects(
    () => createTeam(req({ name: '팀' }, ''), deps(fakeDb())),
    (e) => e instanceof TeamError && e.status === 401,
  );
});

test('🔴 위조 토큰은 401', async () => {
  await assert.rejects(
    () => createTeam(req({ name: '팀' }), deps(fakeDb(), { throwOnToken: true })),
    (e) => e.status === 401,
  );
});

/* ── 생성·참가 ───────────────────────────────────────────────────────── */

test('팀을 만들면 만든 사람이 첫 팀원이 된다', async () => {
  const db = fakeDb();
  const out = await createTeam(req({ name: '사이 팀' }), deps(db));
  assert.equal(out.name, '사이 팀');
  assert.equal(out.role, 'owner');
  assert.equal(out.inviteCode.length, 6);
  assert.ok(
    db.writes.some((w) => w.path.endsWith('/members/u1')),
    '팀원 문서가 없다',
  );
});

test('빈 이름·과한 길이는 400', async () => {
  for (const name of ['', '   ', 'x'.repeat(41)]) {
    await assert.rejects(
      () => createTeam(req({ name }), deps(fakeDb())),
      (e) => e.status === 400,
    );
  }
});

test('초대 코드로 참가한다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  const joined = await joinTeam(req({ inviteCode: made.inviteCode }), deps(db, { uid: 'u2' }));
  assert.equal(joined.teamId, made.teamId);
  assert.equal(joined.role, 'member');
});

test('소문자로 쳐도 참가된다 — 코드를 손으로 옮겨 적는 값이다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  const joined = await joinTeam(
    req({ inviteCode: made.inviteCode.toLowerCase() }),
    deps(db, { uid: 'u2' }),
  );
  assert.equal(joined.teamId, made.teamId);
});

test('🔴 참가 응답에 초대 코드가 없다 — 재배포 경로를 만들지 않는다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  const joined = await joinTeam(req({ inviteCode: made.inviteCode }), deps(db, { uid: 'u2' }));
  assert.equal(joined.inviteCode, undefined);
});

test('🔴 틀린 코드와 없는 팀이 같은 응답이다 — 나뉘면 코드 탐색 도구가 된다', async () => {
  const db = fakeDb();
  await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  for (const code of ['ZZZZZZ', 'abc']) {
    await assert.rejects(
      () => joinTeam(req({ inviteCode: code }), deps(db, { uid: 'u2' })),
      (e) => e.status === 404 && e.reason === 'bad-code',
    );
  }
});

/* ── 마찰 적재 ───────────────────────────────────────────────────────── */

async function teamWithMember(db, uid = 'u1') {
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid }));
  return made.teamId;
}

test('🔴 팀원이 아니면 403 — 남의 팀 지표에 숫자를 넣을 수 없다', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db, 'owner');
  await assert.rejects(
    () =>
      recordFriction(
        req({ teamId, days: [{ dateKey: '2026-08-17', counts: { misread: 1 } }] }),
        deps(db, { uid: 'stranger' }),
      ),
    (e) => e.status === 403,
  );
});

test('팀원의 카운트는 merge로 적재된다', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db);
  const out = await recordFriction(
    req({ teamId, days: [{ dateKey: '2026-08-17', counts: { misread: 2, clear: 1 } }] }),
    deps(db),
  );
  assert.deepEqual(out.accepted, [{ dateKey: '2026-08-17', counts: { misread: 2, clear: 1 } }]);
  const write = db.writes.find((w) => w.path.includes('frictionCounts'));
  assert.ok(
    write.path.endsWith('frictionCounts/' + teamId + '_2026-08-17'),
    '문서 id 규약이 깨졌다: ' + write.path,
  );
  assert.equal(write.merge, true, '덮어쓰면 동시 업로드가 서로를 지운다');
  assert.equal(write.data.teamId, teamId, '규칙이 팀원 확인에 쓰는 필드다');
});

test('🔴 화이트리스트 밖 필드는 Firestore에 도달하지 않는다 (본문이 들어올 자리)', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db);
  await recordFriction(
    req({
      teamId,
      days: [
        {
          dateKey: '2026-08-17',
          counts: { misread: 1, messageBody: '대외비 원문입니다', note: 'x' },
        },
      ],
    }),
    deps(db),
  );
  const dumped = JSON.stringify(db.writes.filter((w) => w.path.includes('frictionCounts')));
  assert.ok(!dumped.includes('대외비'), '본문이 통과했다');
  assert.ok(!dumped.includes('messageBody'));
});

test('🔴 마찰 문서에 uid가 남지 않는다 — 개인 단위로 분해되면 안 된다 (필수 9)', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db, 'sensitive-uid');
  await recordFriction(
    req({ teamId, days: [{ dateKey: '2026-08-17', counts: { venting: 1 } }] }),
    deps(db, { uid: 'sensitive-uid' }),
  );
  const write = db.writes.find((w) => w.path.includes('frictionCounts'));
  assert.ok(!JSON.stringify(write.data).includes('sensitive-uid'));
  assert.equal(write.data.contributorUid, undefined);
});

test('음수·소수·거대값은 0으로 버린다', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db);
  const out = await recordFriction(
    req({
      teamId,
      days: [{ dateKey: '2026-08-17', counts: { misread: -5, venting: 1.5, clear: 99999 } }],
    }),
    deps(db),
  );
  assert.deepEqual(out.accepted, []);
});

test('날짜 형식이 아니면 건너뛴다', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db);
  const out = await recordFriction(
    req({ teamId, days: [{ dateKey: 'yesterday', counts: { misread: 1 } }] }),
    deps(db),
  );
  assert.deepEqual(out.accepted, []);
});

test('🔴 한 번에 올릴 수 있는 날짜 수에 상한이 있다 — 폭주한 클라이언트가 문서를 늘리지 못한다', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db);
  const days = Array.from({ length: 50 }, (_, i) => ({
    dateKey: '2026-08-' + String((i % 28) + 1).padStart(2, '0'),
    counts: { misread: 1 },
  }));
  const out = await recordFriction(req({ teamId, days }), deps(db));
  assert.ok(out.accepted.length <= 31, '상한이 없다: ' + out.accepted.length);
});

test('🔴 반영된 것만 응답에 담긴다 — 클라이언트는 이만큼만 로컬에서 뺀다', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db);
  const out = await recordFriction(
    req({
      teamId,
      days: [
        { dateKey: '2026-08-17', counts: { misread: 1 } },
        { dateKey: 'bad', counts: { misread: 9 } },
      ],
    }),
    deps(db),
  );
  assert.deepEqual(out.accepted, [{ dateKey: '2026-08-17', counts: { misread: 1 } }]);
});

/* ── 팀 관리 — 내보내기·이양·재발급·이름 변경 (2026-08-16) ────────────── */

import {
  removeMember,
  transferOwnership,
  regenerateInvite,
  renameTeam,
} from '../functions/teams.js';

test('🔴 팀원이 팀원을 내보낼 수 없다', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db, 'owner');
  await joinTeam(req({ inviteCode: (await createTeam(req({ name: 'x' }), deps(db, { uid: 'o2' }))).inviteCode }), deps(db, { uid: 'member' })).catch(() => {});
  await assert.rejects(
    () => removeMember(req({ teamId, uid: 'someone' }), deps(db, { uid: 'stranger' })),
    (e) => e.status === 403,
  );
});

test('🔴 팀장은 자기 자신을 내보낼 수 없다 — 관리자 없는 팀이 남는다', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db, 'owner');
  await assert.rejects(
    () => removeMember(req({ teamId, uid: 'owner' }), deps(db, { uid: 'owner' })),
    (e) => e.status === 400 && e.reason === 'cannot-change-self',
  );
});

test('없는 팀원을 내보내려 하면 404', async () => {
  const db = fakeDb();
  const teamId = await teamWithMember(db, 'owner');
  await assert.rejects(
    () => removeMember(req({ teamId, uid: '유령' }), deps(db, { uid: 'owner' })),
    (e) => e.status === 404,
  );
});

test('🔴 팀장 이양은 ownerUid도 함께 옮긴다 — 안 옮기면 다음 접속에서 자동 복구가 되돌린다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  await joinTeam(req({ inviteCode: made.inviteCode }), deps(db, { uid: 'next' }));

  const out = await transferOwnership(
    req({ teamId: made.teamId, uid: 'next' }),
    deps(db, { uid: 'owner' }),
  );
  assert.equal(out.ownerUid, 'next');
  const teamWrite = db.writes.filter((w) => w.path.endsWith(made.teamId) && w.data.ownerUid);
  assert.equal(teamWrite.at(-1).data.ownerUid, 'next', 'ownerUid가 안 옮겨졌다');
});

/**
 * 🔴 **2026-08-16 계약 변경** (사용자 지시). 이 테스트는 원래 「열람 권한 유지」를 지켰다 —
 *    "갑자기 안 보이면 사고"라는 이유였다. 그런데 그러면 **팀장을 넘긴 사람이 아무 설정 없이
 *    계속 팀 전체 지표를 본다.** 이 제품의 기본은 「참가하면 자동으로 열리는 쪽이 아니라 팀장이
 *    열어 주는 쪽」이므로, 이양한 사람도 **다른 팀원과 같은 기본값(꺼짐)**이어야 한다.
 *    새 팀장이 다시 켜 줄 수 있으므로 되돌릴 수 없는 변화도 아니다.
 */
test('🔴 이양 후 옛 팀장은 쫓겨나지 않지만 대시보드 열람은 기본값(꺼짐)으로 돌아간다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  await joinTeam(req({ inviteCode: made.inviteCode }), deps(db, { uid: 'next' }));
  const out = await transferOwnership(
    req({ teamId: made.teamId, uid: 'next' }),
    deps(db, { uid: 'owner' }),
  );

  const oldOwner = db.writes.filter((w) => w.path.endsWith('/members/owner')).at(-1);
  assert.equal(oldOwner.data.role, 'member', '쫓아내면 안 된다');
  assert.equal(oldOwner.data.canViewDashboard, false, '권한을 내려놨는데 지표가 계속 보인다');
  // 🔴 응답도 같은 값을 말해야 한다 — 클라이언트가 이 값을 그대로 저장한다.
  assert.equal(out.canViewDashboard, false, '서버 응답과 실제 기록이 다르다');
});

test('🔴 새 팀장은 열람 권한을 받는다 — 관리자가 지표를 못 보면 관리가 안 된다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  await joinTeam(req({ inviteCode: made.inviteCode }), deps(db, { uid: 'next' }));
  await transferOwnership(req({ teamId: made.teamId, uid: 'next' }), deps(db, { uid: 'owner' }));

  const newOwner = db.writes.filter((w) => w.path.endsWith('/members/next')).at(-1);
  assert.equal(newOwner.data.role, 'owner');
  assert.equal(newOwner.data.canViewDashboard, true);
});

test('🔴 팀원은 이양할 수 없다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  await joinTeam(req({ inviteCode: made.inviteCode }), deps(db, { uid: 'm' }));
  await assert.rejects(
    () => transferOwnership(req({ teamId: made.teamId, uid: 'owner' }), deps(db, { uid: 'm' })),
    (e) => e.status === 403,
  );
});

test('초대 코드를 새로 발급하면 옛 코드가 바뀐다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  const out = await regenerateInvite(req({ teamId: made.teamId }), deps(db, { uid: 'owner' }));
  assert.equal(out.inviteCode.length, 6);
  assert.notEqual(out.inviteCode, made.inviteCode);
});

test('🔴 팀원은 초대 코드를 재발급할 수 없다', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '팀' }), deps(db, { uid: 'owner' }));
  await joinTeam(req({ inviteCode: made.inviteCode }), deps(db, { uid: 'm' }));
  await assert.rejects(
    () => regenerateInvite(req({ teamId: made.teamId }), deps(db, { uid: 'm' })),
    (e) => e.status === 403,
  );
});

test('팀 이름을 바꾼다 · 빈 이름은 거절', async () => {
  const db = fakeDb();
  const made = await createTeam(req({ name: '옛 이름' }), deps(db, { uid: 'owner' }));
  const out = await renameTeam(req({ teamId: made.teamId, name: '새 이름' }), deps(db, { uid: 'owner' }));
  assert.equal(out.name, '새 이름');
  await assert.rejects(
    () => renameTeam(req({ teamId: made.teamId, name: '  ' }), deps(db, { uid: 'owner' })),
    (e) => e.status === 400,
  );
});
