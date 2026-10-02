/**
 * 팀 나가기·계정 삭제 (L22-②③ — 2026-09-30, 개인정보 삭제권).
 *
 * 🔴 **판정표 (2026-09-30 사용자 승인)** — 표에 없는 경우를 임의로 처리하지 않는다.
 *
 * | 조건 | 팀 나가기(`leave`) | 계정 삭제(`deleteAccount`) |
 * |---|---|---|
 * | 팀원 | 내 명부 문서만 삭제(팀 용어집은 팀 자산이라 남김) | 같음 |
 * | 팀장 + 다른 팀원 있음 | **거절(409)** — 먼저 팀장 이양 | **전체 거절(409)** — 아무것도 지우지 않는다 |
 * | 팀장 + 혼자 | 팀 전체 삭제(명부·용어집·지표) | 같음 |
 * | (계정 삭제만) 공통 | — | `users/{uid}`(설정·학습 통계·개인 용어집) · 사용 카운터 · 로그인 계정 삭제 |
 *
 * 🔴 **팀장 판정은 명부의 `role`과 팀 문서의 `ownerUid` 둘 중 하나라도 맞으면 팀장이다.** 옛 버그로
 *    강등된 창설자(`whoAmI` 자동 복구 주석)를 팀원으로 보고 내보내면, `ownerUid`가 떠난 사람을 가리키는
 *    팀이 남아 누구도 팀장으로 복구되지 않는다.
 * 🔴 **계정 삭제는 막히면 하나도 지우지 않는다** — 반쯤 지운 계정은 되돌릴 수도, 다시 시도할 이유도
 *    설명하기 어렵다. 막히지 않으면 전부 **멱등**이라(이미 없는 것을 지워도 성공) 중간에 끊겨도
 *    다시 부르면 끝까지 간다. 로그인 계정 삭제를 **맨 마지막**에 둔다 — 먼저 지우면 재시도할 토큰이 없다.
 * 🔴 Zero Retention: 로그·응답에 이메일·이름을 싣지 않는다. 돌려주는 것은 건수뿐이다.
 * 🔴 **판정은 순수 함수**(`planLeave`·`planAccountDeletion`)이고, Firestore·Auth는 `accountStore`
 *    어댑터 뒤에 있다 — 테스트는 어댑터를 대역으로 바꿔 판정표 전체를 네트워크 없이 확인한다.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { TeamError, requireUid } from './teams.js';

/**
 * 거절(409)에 **막고 있는 팀**을 싣는다 (2026-10-02 실확장 확인 중 발견).
 * 🔴 내 팀 목록은 기기에만 있어서, 확장을 다시 설치하면 「팀장을 넘겨 주세요」라는데 **어느 팀인지
 *    화면에 없었다** — 사용자가 계정을 영영 못 지운다. 팀 id·이름만 싣는다(초대 코드·팀원 정보 없음).
 */
function ownerMustTransfer(blocked) {
  const error = new TeamError(409, 'owner-must-transfer');
  error.extra = { blockedTeams: blocked.map(({ teamId, name }) => ({ teamId, name: name ?? null })) };
  return error;
}

/** 한 배치에 넣는 삭제 수 — Firestore 배치 상한(500) 아래로 둔다. */
const DELETE_BATCH = 400;

/**
 * 팀 나가기 판정.
 * @param {{teamId: string, isOwner: boolean, memberCount: number} | null} membership
 * @returns {'leave' | 'delete-team' | 'blocked'}
 */
export function planLeave(membership) {
  if (!membership) throw new TeamError(403, 'not-a-member');
  if (!membership.isOwner) return 'leave';
  return membership.memberCount > 1 ? 'blocked' : 'delete-team';
}

/**
 * 계정 삭제 판정 — 소속 전부를 한 번에 본다.
 * @param {Array<{teamId: string, isOwner: boolean, memberCount: number}>} memberships
 */
export function planAccountDeletion(memberships) {
  const plan = { blocked: [], deleteTeams: [], leaveTeams: [] };
  for (const membership of memberships) {
    const kind = planLeave(membership);
    if (kind === 'blocked') plan.blocked.push(membership.teamId);
    else if (kind === 'delete-team') plan.deleteTeams.push(membership.teamId);
    else plan.leaveTeams.push(membership.teamId);
  }
  return plan;
}

/** `teamV1` `action: "leave"` — 서버 명부에서 나간다. */
export async function leaveTeamOnServer(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  if (teamId === '') throw new TeamError(400, 'no-team');

  const store = deps.accountStore();
  const membership = await store.membership(teamId, uid);
  const kind = planLeave(membership);
  if (kind === 'blocked') throw ownerMustTransfer([membership]);
  if (kind === 'delete-team') {
    await store.deleteTeam(teamId);
    return { teamId, left: true, teamDeleted: true };
  }
  await store.deleteMember(teamId, uid);
  return { teamId, left: true, teamDeleted: false };
}

/**
 * `teamV1` `action: "deleteAccount"` — 계정과 서버 데이터를 지운다.
 * 🔴 `confirm: "DELETE"`가 없으면 거절한다 — 되돌릴 수 없는 호출이 실수(재시도·잘못 붙인 action)로
 *    나가지 않게 하는 마지막 확인이다. 화면의 2단계 확인과 별개다.
 */
export async function deleteAccount(req, deps) {
  const uid = await requireUid(req, deps);
  if (req.body?.confirm !== 'DELETE') throw new TeamError(400, 'not-confirmed');

  const store = deps.accountStore();
  const memberships = await store.memberships(uid);
  const plan = planAccountDeletion(memberships);
  if (plan.blocked.length > 0) {
    throw ownerMustTransfer(memberships.filter((m) => plan.blocked.includes(m.teamId)));
  }

  for (const teamId of plan.leaveTeams) await store.deleteMember(teamId, uid);
  for (const teamId of plan.deleteTeams) await store.deleteTeam(teamId);
  await store.deleteUserData(uid);
  await store.deleteAuthUser(uid); // 🔴 마지막 — 먼저 지우면 실패 시 재시도할 토큰이 없다.

  return { deleted: true, leftTeams: plan.leaveTeams.length, deletedTeams: plan.deleteTeams.length };
}

/**
 * `teamV1` `action: "myTeams"` — **서버 명부 기준 내 소속 팀** (2026-10-02).
 * 🔴 기기를 바꾸거나 확장을 다시 설치하면 로컬 팀 목록이 비어 팀 화면·팀장 이양·계정 삭제가 막혔다.
 *    이걸로 목록을 되살린다. 🔴 초대 코드·팀원 명단은 싣지 않는다 — 내 소속·역할·이름뿐.
 * @returns {Promise<{teams: Array<{teamId, name, role, canViewDashboard}>}>}
 */
export async function listMyTeams(req, deps) {
  const uid = await requireUid(req, deps);
  const memberships = await deps.accountStore().memberships(uid);
  return {
    teams: memberships.map((m) => ({
      teamId: m.teamId,
      name: m.name ?? null,
      role: m.isOwner ? 'owner' : 'member',
      canViewDashboard: m.isOwner || m.canViewDashboard === true,
    })),
  };
}

/**
 * Firestore·Auth 어댑터 (Admin SDK — 규칙을 우회하므로 서버 전용).
 *
 * 🔴 **소속 조회는 팀 전체를 훑는다.** 「내 팀 목록」을 한 번에 뽑으려면 `members` 컬렉션 그룹 색인이
 *    필요한데(teamClient.js 「알려진 한계」), 계정 삭제는 드문 호출이고 출시 초기 팀 수는 적다.
 *    팀이 수천 개가 되면 색인 기반 질의로 바꾼다.
 */
export function accountStore(db = getFirestore(), auth = getAuth()) {
  const teamRef = (teamId) => db.collection('teams').doc(teamId);

  async function describe(teamId, uid, memberSnap) {
    const [team, members] = await Promise.all([
      teamRef(teamId).get(),
      teamRef(teamId).collection('members').limit(2).get(),
    ]);
    return {
      teamId,
      name: team.exists ? (team.get('name') ?? null) : null,
      isOwner: memberSnap.get('role') === 'owner' || (team.exists && team.get('ownerUid') === uid),
      canViewDashboard: memberSnap.get('canViewDashboard') === true,
      memberCount: members.size,
    };
  }

  async function deleteQuery(query) {
    for (;;) {
      const snap = await query.limit(DELETE_BATCH).get();
      if (snap.empty) return;
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
      if (snap.size < DELETE_BATCH) return;
    }
  }

  return {
    async membership(teamId, uid) {
      const snap = await teamRef(teamId).collection('members').doc(uid).get();
      return snap.exists ? describe(teamId, uid, snap) : null;
    },
    async memberships(uid) {
      const teams = await db.collection('teams').listDocuments();
      if (teams.length === 0) return [];
      const snaps = await db.getAll(...teams.map((ref) => ref.collection('members').doc(uid)));
      const found = [];
      snaps.forEach((snap, index) => {
        if (snap.exists) found.push(describe(teams[index].id, uid, snap));
      });
      return Promise.all(found);
    },
    async deleteMember(teamId, uid) {
      await teamRef(teamId).collection('members').doc(uid).delete();
    },
    /** 팀 문서 + 하위(명부·용어집) + 팀 지표. */
    async deleteTeam(teamId) {
      await db.recursiveDelete(teamRef(teamId));
      await deleteQuery(db.collection('frictionCounts').where('teamId', '==', teamId));
    },
    /** `users/{uid}` + 하위(학습 통계·개인 용어집) + 사용 카운터. */
    async deleteUserData(uid) {
      await db.recursiveDelete(db.collection('users').doc(uid));
      await deleteQuery(db.collection('refineQuota').where('uid', '==', uid));
    },
    async deleteAuthUser(uid) {
      try {
        await auth.deleteUser(uid);
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error; // 이미 없으면 성공(멱등).
      }
    },
  };
}
