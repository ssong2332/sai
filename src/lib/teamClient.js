/**
 * 팀 — 생성·참가·팀 용어집·마찰 카운트 업로드 (Spec §3).
 *
 * 🔴 **두 종류의 통신이 섞여 있다. 구분이 중요하다.**
 *    ① `teamV1` (Cloud Functions): 생성·참가·마찰 적재. 초대 코드 검증과 마찰 쓰기는
 *       **규칙으로 표현할 수 없어** 서버가 판정한다(`functions/teams.js` 헤더).
 *    ② Firestore REST: 팀 용어집 읽기·쓰기, 마찰 카운트 읽기. 여기는 `firestore.rules`의
 *       팀원 확인만으로 충분하므로 서버를 거치지 않는다 — 거치면 함수 요금만 늘고 느려진다.
 *
 * 🔴 **초대 코드를 저장하지 않는다.** 참가에 한 번 쓰고 버린다. 로컬에 남기면 이 기기를 쓰는
 *    누구나 팀에 다시 들어갈 수 있는 열쇠가 된다.
 *
 * 🔴 Zero Retention (Spec 필수 5): 이 파일이 올리는 것은 **팀 이름·용어 대응쌍·정수 카운트**뿐이다.
 *    메시지 본문을 실어 보내는 함수가 없다.
 */

import { FIREBASE_PROJECT_ID, TEAM_ENDPOINT } from '../config.js';
import { getIdToken } from './authClient.js';
import { getLocal, setLocal, removeLocal, STORAGE_KEYS } from './storage.js';
import { encodeFields, decodeFields } from './syncClient.js';
import { filterByLanguage } from './glossary.js';
import {
  takeFrictionBatch,
  clearSentFriction,
  pendingFrictionTeams,
  LEGACY_TEAM_BUCKET,
} from './friction.js';

const FIRESTORE_ROOT = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export const TEAM_ERRORS = {
  NOT_SIGNED_IN: 'not-signed-in',
  BAD_CODE: 'bad-code',
  NOT_A_MEMBER: 'not-a-member',
  NOT_OWNER: 'not-owner',
  CANNOT_CHANGE_SELF: 'cannot-change-self',
  NO_TEAM: 'no-team',
  NETWORK: 'network-failed',
  UNKNOWN: 'unknown',
};

export class TeamClientError extends Error {
  constructor(reason, detail = '') {
    super(`team:${reason}${detail ? ` (${detail})` : ''}`);
    this.reason = reason;
    this.detail = detail;
  }
}

export function teamErrorMessage(reason, detail = '') {
  switch (reason) {
    case TEAM_ERRORS.NOT_SIGNED_IN:
      return '먼저 로그인해 주세요 — 팀 기능은 계정이 필요해요';
    case TEAM_ERRORS.BAD_CODE:
      // 🔴 "없는 팀"과 "틀린 코드"를 구분해 말하지 않는다(서버가 구분하지 않는다 — 탐색 방지).
      return '초대 코드를 찾을 수 없어요 — 코드를 다시 확인해 주세요';
    case TEAM_ERRORS.NOT_A_MEMBER:
      return '이 팀의 팀원이 아니에요';
    case TEAM_ERRORS.NOT_OWNER:
      return '팀장만 할 수 있어요';
    case TEAM_ERRORS.CANNOT_CHANGE_SELF:
      // 🔴 막는 이유를 말한다 — 「안 됩니다」만 쓰면 고장으로 읽힌다.
      return '팀장 본인의 권한은 끌 수 없어요 — 되돌릴 방법이 없어져요';
    case TEAM_ERRORS.NETWORK:
      return '팀 서버에 연결하지 못했어요 — 네트워크를 확인해 주세요';
    default:
      return `팀 작업에 실패했어요${detail ? ` (${detail})` : ''}`;
  }
}

/* ── 소속 팀 (로컬) ──────────────────────────────────────────────────── */

/**
 * 소속된 팀 전부.
 *
 * 🔴 **예전 단일 팀(`TEAM`)을 목록으로 이관한다** (2026-08-16 다중 팀 지원). 이미 팀에 속한
 *    사용자가 업데이트 후 팀을 잃으면 초대 코드를 다시 받아야 하는데, 그 코드는 저장돼 있지
 *    않다 — 잃어버리면 복구 경로가 없다.
 * 🔴 **알려진 한계**: 목록은 이 기기에만 있다. 재설치하면 초대 코드로 다시 들어와야 한다
 *    (서버에서 「내 팀 목록」을 뽑으려면 컬렉션 그룹 질의와 색인이 필요하다 — v2 과제).
 * @returns {Promise<Array<{teamId, name, role, canViewDashboard}>>}
 */
export async function listTeams() {
  const stored = await getLocal(STORAGE_KEYS.TEAMS, null);
  if (Array.isArray(stored)) return stored.filter((t) => typeof t?.teamId === 'string');

  const legacy = await getLocal(STORAGE_KEYS.TEAM, null);
  if (legacy && typeof legacy.teamId === 'string') {
    const migrated = [legacy];
    await setLocal(STORAGE_KEYS.TEAMS, migrated);
    await setLocal(STORAGE_KEYS.ACTIVE_TEAM, legacy.teamId);
    // 🔴 옛 키는 지우지 않는다 — 이관이 실패했을 때 되돌아갈 자리가 남아 있어야 한다.
    return migrated;
  }
  return [];
}

/** 지금 보고 있는 팀. 목록이 비면 null. */
export async function getTeam() {
  const teams = await listTeams();
  if (teams.length === 0) return null;
  const activeId = await getLocal(STORAGE_KEYS.ACTIVE_TEAM, null);
  // 🔴 저장된 id가 목록에 없으면(나간 팀 등) 첫 번째로 되돌린다 — null을 돌려주면 팀에
  //    속해 있는데 "팀 없음" 화면이 뜬다.
  return teams.find((team) => team.teamId === activeId) ?? teams[0];
}

/** 보고 있는 팀을 바꾼다. */
export async function setActiveTeam(teamId) {
  await setLocal(STORAGE_KEYS.ACTIVE_TEAM, teamId);
}

/** 목록에 넣거나 갱신하고, 그 팀을 활성으로 만든다. */
async function upsertTeam(team) {
  const teams = await listTeams();
  const next = [...teams.filter((item) => item.teamId !== team.teamId), team];
  await setLocal(STORAGE_KEYS.TEAMS, next);
  await setLocal(STORAGE_KEYS.ACTIVE_TEAM, team.teamId);
  return team;
}

/**
 * 이 기기에서 팀 연결을 끊는다.
 * 🔴 **로컬 목록에서만 뺀다.** 서버의 팀원 문서는 남는다 — 규칙상 클라이언트가 지울 수 없고,
 *    "나갔는데 다시 들어가려면 코드가 또 필요"한 쪽이 안전하다. 화면 문구도 그렇게 쓴다.
 */
export async function leaveTeam(teamId = null) {
  const teams = await listTeams();
  const target = teamId ?? (await getTeam())?.teamId;
  const next = teams.filter((team) => team.teamId !== target);
  await setLocal(STORAGE_KEYS.TEAMS, next);
  await setLocal(STORAGE_KEYS.ACTIVE_TEAM, next[0]?.teamId ?? null);
  if (next.length === 0) await removeLocal(STORAGE_KEYS.TEAM); // 이관 원본도 정리한다.
}

/* ── teamV1 (Cloud Functions) ────────────────────────────────────────── */

async function callTeamApi(action, body, fetchImpl) {
  const token = await getIdToken({ fetchImpl });
  if (!token) throw new TeamClientError(TEAM_ERRORS.NOT_SIGNED_IN);

  let response;
  try {
    response = await fetchImpl(TEAM_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new TeamClientError(TEAM_ERRORS.NETWORK);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // 🔴 서버가 준 사유 코드를 그대로 쓴다 — 화면 문구를 여기서 지어내면 서버와 말이 갈린다.
    const reason = Object.values(TEAM_ERRORS).includes(payload?.error)
      ? payload.error
      : TEAM_ERRORS.UNKNOWN;
    throw new TeamClientError(reason, String(response.status));
  }
  return payload;
}

/**
 * 팀을 만든다. 🔴 초대 코드는 **응답에서 화면으로만** 간다 — 저장하지 않는다.
 * @returns {Promise<{teamId, name, inviteCode, role}>}
 */
export async function createTeam(name, profile = {}, { fetchImpl = globalThis.fetch } = {}) {
  const result = await callTeamApi(
    'create',
    { name, displayName: profile.displayName ?? null, jobTitle: profile.jobTitle ?? null },
    fetchImpl,
  );
  await upsertTeam({
    teamId: result.teamId,
    name: result.name,
    role: result.role,
    canViewDashboard: true, // 팀장은 항상 본다.
  });
  return result;
}

/** 초대 코드로 참가한다. */
export async function joinTeam(inviteCode, profile = {}, { fetchImpl = globalThis.fetch } = {}) {
  const result = await callTeamApi(
    'join',
    {
      inviteCode,
      displayName: profile.displayName ?? null,
      jobTitle: profile.jobTitle ?? null,
    },
    fetchImpl,
  );
  return upsertTeam({
    teamId: result.teamId,
    name: result.name,
    role: result.role,
    canViewDashboard: result.canViewDashboard === true,
  });
}

/**
 * 서버에 내 역할·권한을 다시 묻고 로컬을 맞춘다.
 *
 * 🔴 **로컬 값은 참가 시점의 스냅샷이다.** 팀장이 나중에 권한을 켜거나 꺼도 이 기기는 모른다 —
 *    대시보드를 열기 전에 물어야 "권한이 없는데 열리는" 또는 "받았는데 안 열리는" 상태가 없다.
 * 🔴 실패하면 **로컬 값을 지우지 않는다.** 네트워크 문제로 소속이 사라진 것처럼 보이면
 *    사용자가 팀에 다시 참가하려 든다(그리고 초대 코드가 없다).
 */
export async function refreshMembership({ fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) return null;
  const me = await callTeamApi('me', { teamId: team.teamId }, fetchImpl);
  return upsertTeam({
    ...team,
    role: me.role ?? team.role,
    canViewDashboard: me.canViewDashboard === true,
  });
}

/**
 * 🔴 **속한 팀 전부의 역할·권한을 서버에 다시 묻는다** (2026-08-16 사용자 지적 ⑦).
 *
 * 왜 필요한가 — 로컬의 `role`·`canViewDashboard`는 **참가한 순간의 스냅샷**이고, 그 뒤에
 * 서버에서 바뀌는 일이 실제로 세 가지 있다:
 *   ① 팀장이 나에게 팀장을 넘겼다 → 서버는 `owner`인데 내 화면은 계속 팀원이라 **팀 관리가
 *      영영 안 보인다.** (사용자가 겪은 증상이 이것이다.)
 *   ② 팀장이 대시보드 열람을 껐다 → 내 화면엔 아직 대시보드 버튼이 남아 있다.
 *   ③ 팀장이 나를 내보냈다 → 여기서는 다루지 않는다(아래 실패 정책).
 *
 * 🔴 **`refreshMembership`으로는 안 됐다.** 그건 **활성 팀 하나**만 고치고, 게다가 `upsertTeam`이
 *    목록 순서를 바꾸고 그 팀을 활성으로 만들어 버린다 — 여러 팀에 반복하면 **활성 팀이 마지막
 *    팀으로 튄다.** 그래서 여기서는 저장을 **제자리 갱신**으로 직접 한다.
 * 🔴 **실패한 팀은 이전 값을 유지한다.** 네트워크가 끊겼다고 소속이 사라지면 사용자는 팀에
 *    다시 참가하려 들고, 그 초대 코드는 우리가 저장하지 않는다.
 * 🔴 **바뀐 게 없으면 저장하지 않는다** — 매번 쓰면 storage 이벤트가 돌아 화면이 헛돈다.
 *
 * @returns {Promise<{teams: Array, changed: boolean}>}
 */
export async function refreshAllMemberships({ fetchImpl = globalThis.fetch } = {}) {
  const teams = await listTeams();
  if (teams.length === 0) return { teams, changed: false };

  const results = await Promise.all(
    teams.map(async (team) => {
      try {
        const me = await callTeamApi('me', { teamId: team.teamId }, fetchImpl);
        return {
          ...team,
          role: me.role ?? team.role,
          canViewDashboard: me.role === 'owner' || me.canViewDashboard === true,
        };
      } catch {
        return team; // 이 팀만 옛 값으로 남는다.
      }
    }),
  );

  const changed = results.some(
    (next, index) =>
      next.role !== teams[index].role ||
      next.canViewDashboard !== teams[index].canViewDashboard,
  );
  // 🔴 순서·활성 팀을 건드리지 않는다 — `upsertTeam`을 쓰지 않는 이유가 이것이다.
  if (changed) await setLocal(STORAGE_KEYS.TEAMS, results);
  return { teams: results, changed };
}

/** 팀원 목록 (팀장 전용). */
export async function listTeamMembers({ fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) throw new TeamClientError(TEAM_ERRORS.NO_TEAM);
  const result = await callTeamApi('members', { teamId: team.teamId }, fetchImpl);
  return Array.isArray(result?.members) ? result.members : [];
}

/** 팀원을 내보낸다 (팀장 전용). 🔴 이미 올라간 지표는 남는다 — 팀 단위 합계라 분해가 불가능하다. */
export async function removeTeamMember(uid, { fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) throw new TeamClientError(TEAM_ERRORS.NO_TEAM);
  return callTeamApi('kick', { teamId: team.teamId, uid }, fetchImpl);
}

/**
 * 팀장을 넘긴다 (팀장 전용).
 * 🔴 넘긴 뒤 **내 역할이 팀원으로 바뀐다** — 로컬도 즉시 맞춰야 다음 화면이 팀장 메뉴를
 *    계속 보여주지 않는다.
 */
export async function transferOwnership(uid, { fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) throw new TeamClientError(TEAM_ERRORS.NO_TEAM);
  const result = await callTeamApi('transfer', { teamId: team.teamId, uid }, fetchImpl);
  /**
   * 🔴 **서버가 정한 값을 그대로 쓴다** (2026-08-16). 예전에는 여기서 `canViewDashboard: true`를
   *    **직접 적어** 서버와 말이 갈릴 수 있었다 — 서버가 기본값을 끄기로 바뀌자 화면만 켜져 있는
   *    상태가 됐다. 권한 판정의 출처는 언제나 서버 하나여야 한다.
   */
  await upsertTeam({
    ...team,
    role: 'member',
    canViewDashboard: result?.canViewDashboard === true,
  });
  return result;
}

/** 초대 코드를 새로 발급한다 (팀장 전용). 🔴 옛 코드는 즉시 무효다. */
export async function regenerateInvite({ fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) throw new TeamClientError(TEAM_ERRORS.NO_TEAM);
  const result = await callTeamApi('reinvite', { teamId: team.teamId }, fetchImpl);
  return result.inviteCode;
}

/** 팀 이름을 바꾼다 (팀장 전용). */
export async function renameTeam(name, { fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) throw new TeamClientError(TEAM_ERRORS.NO_TEAM);
  const result = await callTeamApi('rename', { teamId: team.teamId, name }, fetchImpl);
  await upsertTeam({ ...team, name: result.name });
  return result.name;
}

/** 팀원의 대시보드 열람 권한을 바꾼다 (팀장 전용). */
export async function setMemberDashboardAccess(uid, canView, { fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) throw new TeamClientError(TEAM_ERRORS.NO_TEAM);
  return callTeamApi(
    'permission',
    { teamId: team.teamId, uid, canViewDashboard: canView === true },
    fetchImpl,
  );
}

/**
 * 쌓인 마찰 카운트를 올린다.
 *
 * 🔴 **서버가 반영했다고 응답한 만큼만** 로컬에서 뺀다. "성공했으니 전부 지워"로 하면 서버가
 *    버린 항목(형식 오류·상한 초과)이 조용히 사라진다.
 * 🔴 팀이 없으면 **아무것도 하지 않는다** — 개인 사용자의 카운트는 어디에도 올라가지 않는다.
 * @returns {Promise<{uploaded: number}>} 반영된 날짜 수. 팀이 없거나 보낼 것이 없으면 0.
 */
export async function uploadFriction({ fetchImpl = globalThis.fetch } = {}) {
  /**
   * 🔴 **쌓인 팀마다 그 팀으로 올린다** (2026-08-19 사용자 지적으로 고침).
   *
   *    예전에는 무조건 **활성 팀 하나**로 올렸다. 그런데 교정에 실리는 용어집은 «수신자의 팀»을
   *    따르므로, 팀이 둘일 때 **B팀 상대와의 마찰이 A팀 대시보드에 쌓였다.** 팀장이 보는
   *    협업 상황이 실제와 달라지는데, 화면 어디에도 그 사실이 드러나지 않았다.
   *
   * 🔴 **주인 없는 카운트는 올리지 않는다.** 팀에 속하지 않은 대화(개인)의 마찰은
   *    `NO_TEAM_BUCKET`에 남고 어느 팀으로도 가지 않는다 — 예전에는 이런 카운트가 쌓여 있다가
   *    **나중에 팀에 들어가는 순간 그 팀으로 통째로 올라갔다.**
   * 🔴 **내가 속한 팀만 올린다.** 탈퇴한 팀의 칸이 남아 있어도 서버가 거절할 뿐이라, 부르지 않는다.
   * 🔴 **실패는 삼키지 않고 그대로 던진다.** 호출부(`App.jsx`)가 조용히 넘기기로 «선택»한 것이지,
   *    여기서 없던 일로 만들면 네트워크가 죽어도 아무도 모른다. 실패한 팀의 카운트는
   *    `clearSentFriction`을 안 거쳤으므로 **그대로 남아 다음 기회에 다시 올라간다.**
   */
  const teams = await listTeams();
  if (teams.length === 0) return { uploaded: 0 };

  const active = await getTeam();
  const pendingTeams = await pendingFrictionTeams();
  let uploaded = 0;

  for (const bucket of pendingTeams) {
    // 옛 저장물(팀 구분 없이 쌓인 것)은 지금까지의 동작대로 **활성 팀**으로 한 번만 올린다.
    const target =
      bucket === LEGACY_TEAM_BUCKET ? active : teams.find((item) => item.teamId === bucket);
    if (!target) continue;

    const days = await takeFrictionBatch(bucket);
    if (days.length === 0) continue;

    const result = await callTeamApi('friction', { teamId: target.teamId, days }, fetchImpl);
    const accepted = Array.isArray(result?.accepted) ? result.accepted : [];
    await clearSentFriction(bucket, accepted);
    uploaded += accepted.length;
  }
  return { uploaded };
}

/* ── 팀 용어집 (Firestore REST) ──────────────────────────────────────── */

async function firestore(path, { method = 'GET', body, fetchImpl }) {
  const token = await getIdToken({ fetchImpl });
  if (!token) throw new TeamClientError(TEAM_ERRORS.NOT_SIGNED_IN);

  let response;
  try {
    response = await fetchImpl(`${FIRESTORE_ROOT}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new TeamClientError(TEAM_ERRORS.NETWORK);
  }

  if (response.status === 404) return null; // 아직 아무것도 없음 — 오류가 아니다.
  if (response.status === 403) throw new TeamClientError(TEAM_ERRORS.NOT_A_MEMBER, '403');
  if (!response.ok) throw new TeamClientError(TEAM_ERRORS.UNKNOWN, String(response.status));
  return response.json().catch(() => null);
}

/** Firestore 문서 이름(`.../glossary/abc`)에서 id만 뽑는다. */
function docId(name) {
  return String(name ?? '').split('/').pop();
}

/**
 * 팀 용어집을 읽는다. 팀이 없으면 빈 배열.
 * 🔴 실패를 던지지 않는다 — 교정 경로에서도 부르므로, 팀 서버가 죽어도 **개인 용어집으로
 *    교정은 계속돼야 한다.**
 */
export async function listTeamGlossary({ teamId = null, fetchImpl = globalThis.fetch } = {}) {
  /**
   * 🔴 **팀을 지정할 수 있다** (2026-08-16 ⓐ). 교정은 **수신자에 붙은 팀**의 용어를 써야 한다 —
   *    활성 팀을 쓰면 팀이 여럿일 때 엉뚱한 팀 용어가 실린다. 지정이 없으면 활성 팀(화면용).
   */
  const teams = await listTeams();
  const team = teamId ? teams.find((item) => item.teamId === teamId) ?? null : await getTeam();
  if (!team) return [];
  try {
    const page = await firestore(`/teams/${team.teamId}/glossary`, { fetchImpl });
    const entries = (page?.documents ?? []).map((doc) => ({
      id: docId(doc.name),
      ...decodeFields(doc.fields),
      keepSource: doc.fields?.keepSource?.booleanValue === true,
    }));
    /**
     * 🔴 **원문 기준으로 정렬한다** (2026-08-16 사용자 지적: "배치 순서가 꼬이는데?").
     *    Firestore는 정렬을 지정하지 않으면 **문서 id 순**으로 주는데 id는 무작위라, 화면에서는
     *    순서가 뒤죽박죽으로 보이고 새로고침마다 달라 보인다. 사람이 찾는 기준은 원문이다.
     */
    return entries.sort((a, b) => String(a.sourceText).localeCompare(String(b.sourceText), 'ko'));
  } catch {
    return [];
  }
}

/**
 * 팀 용어를 추가·수정한다.
 * 🔴 `updatedBy`에 uid를 넣지 않는다 — 규칙이 허용하는 필드지만, 용어 하나하나에 사람을 붙이면
 *    "누가 이상한 용어를 넣었나"를 따지는 화면이 생긴다. 지금 필요하지 않은 데이터는 만들지 않는다.
 */
export async function saveTeamGlossaryEntry(entry, { fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) throw new TeamClientError(TEAM_ERRORS.NO_TEAM);

  const sourceText = String(entry?.sourceText ?? '').trim();
  if (sourceText === '') throw new TeamClientError(TEAM_ERRORS.UNKNOWN, 'empty');

  const fields = encodeFields({
    sourceText,
    targetText: String(entry?.targetText ?? '').trim(),
    updatedAt: new Date().toISOString(),
  });
  // 🔴 boolean은 `encodeFields`가 다루지 않는다(문자열·정수·배열만) — 직접 넣는다.
  fields.keepSource = { booleanValue: !!entry?.keepSource };

  /**
   * 🔴 **같은 원문이 이미 있으면 그 문서를 덮어쓴다** (2026-08-16 사용자 지적: 덮어쓰기가
   *    작동하지 않았다). 개인 용어집에만 넣었던 규칙이라 팀에는 「배포 → rollouts」·
   *    「배포 → rollout」·「배포 → deployment」가 나란히 쌓였다. 같은 낱말에 규칙이 셋이면
   *    **어느 쪽이 적용되는지 아무도 모른다.**
   */
  let id = entry?.id;
  if (!id) {
    const existing = await listTeamGlossary({ fetchImpl });
    const match = existing.find(
      (item) => String(item.sourceText).trim().toLowerCase() === sourceText.toLowerCase(),
    );
    if (match) id = match.id;
  }
  const path = id
    ? `/teams/${team.teamId}/glossary/${id}?updateMask.fieldPaths=sourceText&updateMask.fieldPaths=targetText&updateMask.fieldPaths=keepSource&updateMask.fieldPaths=updatedAt`
    : `/teams/${team.teamId}/glossary`;
  const result = await firestore(path, {
    method: id ? 'PATCH' : 'POST',
    body: { fields },
    fetchImpl,
  });
  return { id: id ?? docId(result?.name) };
}

export async function removeTeamGlossaryEntry(id, { fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) throw new TeamClientError(TEAM_ERRORS.NO_TEAM);
  await firestore(`/teams/${team.teamId}/glossary/${id}`, { method: 'DELETE', fetchImpl });
}

/**
 * 팀의 마찰·긍정 카운트를 최근 N일치 읽어 합산한다.
 *
 * 🔴 **문서 id를 계산해서 batchGet으로 집는다** — 컬렉션을 쿼리하지 않는다. 규칙이 문서마다
 *    팀원 여부를 확인하므로 쿼리는 남의 팀 문서에 걸려 통째로 거절될 수 있고, 복합 색인도
 *    필요해진다. id가 `{teamId}_{dateKey}`로 고정이라 계산이 가능하다.
 * 🔴 없는 날짜는 그냥 빠진다(`missing`) — 0으로 채우지 않는다. "그날 신호가 없었다"와
 *    "그날 아무도 안 썼다"를 구분할 수 없으므로 지어내지 않는다.
 *
 * @returns {Promise<{teamName: string, days: number, counts: object}|null>} 팀이 없으면 null.
 */
export async function fetchTeamFriction({ days = 30, fetchImpl = globalThis.fetch } = {}) {
  const team = await getTeam();
  if (!team) return null;

  const base = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/frictionCounts`;
  const wanted = [];
  const today = new Date();
  for (let back = 0; back < days; back += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    wanted.push(`${base}/${team.teamId}_${key}`);
  }

  const result = await firestore(':batchGet', {
    method: 'POST',
    body: { documents: wanted },
    fetchImpl,
  });

  /**
   * 🔴 **날짜별로도 돌려준다** (2026-08-16). 합계 하나만 넘기면 대시보드에서 기간을 고를 수
   *    없다 — 「최근 7일」을 눌러도 다시 계산할 원자료가 없기 때문이다. 합계는 편의로 함께 준다.
   */
  const counts = {};
  const byDate = {};
  for (const row of Array.isArray(result) ? result : []) {
    if (!row?.found?.fields) continue;
    const decoded = decodeFields(row.found.fields);
    const dateKey = typeof decoded.dateKey === 'string' ? decoded.dateKey : null;
    const day = {};
    for (const [key, value] of Object.entries(decoded)) {
      if (typeof value !== 'number') continue; // teamId·dateKey 같은 문자열 필드는 건너뛴다.
      counts[key] = (counts[key] ?? 0) + value;
      day[key] = value;
    }
    if (dateKey) byDate[dateKey] = day;
  }
  return { teamName: team.name, days, counts, byDate };
}

/**
 * 소속된 **모든 팀**의 지표를 모은다 (2026-08-16 — 대시보드 팀 전환).
 *
 * 🔴 대시보드는 로그인이 없는 별도 페이지라 스스로 팀을 바꿔 읽을 수 없다. 그래서 확장이
 *    한 번에 다 읽어 넘긴다 — 웹페이지에서 드롭다운으로 전환하는 것이 목적이다.
 * 🔴 **열람 권한이 없는 팀은 뺀다.** 규칙이 어차피 거절하지만, 목록에 이름만 떠도 "볼 수 있는데
 *    안 열린다"로 읽힌다.
 * 🔴 한 팀이 실패해도 나머지는 넘긴다 — 팀 하나의 오류로 대시보드 전체가 데모로 떨어지면 안 된다.
 * @returns {Promise<Array<{teamId, teamName, counts}>>} 지표가 하나도 없는 팀은 빠진다.
 */
export async function fetchAllTeamsFriction({ days = 30, fetchImpl = globalThis.fetch } = {}) {
  const teams = await listTeams();
  const viewable = teams.filter((team) => team.role === 'owner' || team.canViewDashboard === true);
  const active = await getTeam();

  const reports = [];
  for (const team of viewable) {
    try {
      await setActiveTeam(team.teamId); // `fetchTeamFriction`이 활성 팀을 본다.
      const report = await fetchTeamFriction({ days, fetchImpl });
      /**
       * 🔴 **지표가 0건이어도 목록에 넣는다** (2026-08-16 실측이 잡은 결함). 예전에는 0건인 팀을
       *    빼 버려서, 「132」를 골라 대시보드를 열면 **데이터가 있는 다른 팀**이 열렸다 —
       *    리더가 남의 팀 지표를 자기 팀 것으로 읽는 사고다. 빈 팀은 **빈 팀으로 보여준다.**
       * 🔴 날짜별도 함께 넘긴다 — 대시보드가 기간을 다시 계산하려면 원자료가 필요하다.
       */
      reports.push({
        teamId: team.teamId,
        teamName: team.name,
        counts: report?.counts ?? {},
        byDate: report?.byDate ?? {},
      });
    } catch {
      /* 이 팀만 건너뛴다 */
    }
  }
  // 🔴 보고 있던 팀을 반드시 되돌린다 — 대시보드를 한 번 열면 활성 팀이 바뀌어 있으면 안 된다.
  if (active) await setActiveTeam(active.teamId);
  return reports;
}

/**
 * `/v1/refine` payload의 `glossary` 형태로 바꾼다.
 * 🔴 `scope: 'team'`이 핵심이다 — 프롬프트가 `personal > team > ai` 우선순위를 이 값으로 가른다
 *    (`core/refine/prompt.js`의 `glossaryRules()`). 개인 용어와 같은 `scope`로 보내면
 *    같은 낱말이 겹칠 때 어느 쪽이 이기는지 모델이 알 수 없다.
 */
export function toRefinePayloadTeamGlossary(entries, targetLanguage = null) {
  // 🔴 개인 용어집과 **같은 필터**를 쓴다(`lib/glossary.js`) — 두 벌로 두면 규칙이 갈린다.
  return filterByLanguage(entries, targetLanguage).map((entry) => ({
    id: entry.id,
    entryType: 'term',
    scope: 'team',
    sourceText: entry.sourceText,
    targetText: entry.targetText || null,
    keepSource: !!entry.keepSource,
  }));
}
