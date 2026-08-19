/**
 * 팀 생성·참가·마찰 카운트 적재 (Spec §3 F-10/F-26 · 팀 용어집).
 *
 * 🔴 **왜 Functions인가** — `firestore.rules`로는 초대 코드를 검증할 수 없다. 규칙에서 다른
 *    문서의 코드와 대조하려면 그 문서를 **읽을 수 있어야** 하고, 읽을 수 있으면 코드가 노출된다.
 *    그래서 팀 문서는 클라이언트에게 완전히 닫고(`allow read, write: if false`) 가입 판정을
 *    Admin SDK가 한다. 마찰 카운트도 같은 이유로 서버만 쓴다 — 클라이언트가 직접 쓰면 남의
 *    팀 지표에 아무 숫자나 넣을 수 있다.
 *
 * 🔴 **Zero Retention (Spec 필수 5)**: 이 파일이 Firestore에 쓰는 것은 팀 이름·초대 코드·정수
 *    카운트뿐이다. 메시지 본문이 들어갈 필드가 스키마에 아예 없고, 아래 `sanitizeCounts()`가
 *    화이트리스트 밖의 키를 통째로 버린다.
 *
 * 🔴 **개인 단위로 분해되지 않는다** (Spec 필수 9 G1/G2 · EU AI Act, Lessons #7). 마찰 문서에
 *    기여자 uid를 남기지 않는다 — 남기면 "누가 하소연을 많이 했는지"를 만들 수 있고, 그건
 *    이 제품이 만들지 않기로 한 종류의 데이터다. 인증은 **쓸 자격 확인용으로만** 쓰고 버린다.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
// 🔴 `functions/package.json`은 `"type": "module"`이다 — `require`는 여기서 죽는다.
import { randomInt } from 'node:crypto';

/**
 * 마찰 문서에 허용된 카운트 키 — `src/lib/friction.js`의 `FRICTION_EVENTS`와 같아야 한다.
 * 🔴 `refined`는 신호가 아니라 **건강도 지수의 분모**다(Spec §3 「정규화된 마찰」).
 */
const COUNT_KEYS = [
  'misread',
  'venting',
  'forceOffHours',
  'clear',
  'schedule',
  'refined',
  // 2026-08-16 추가 — 이미 판정하고 있던 신호 3종(`src/lib/friction.js` 참고).
  'urgencyGap',
  'missing',
  'sensitiveBlocked',
];

/** 사람이 읽고 옮겨 적는 코드다 — 헷갈리는 글자(0/O, 1/I)를 뺀다. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const MAX_TEAM_NAME = 40;
/**
 * 팀원이 스스로 밝히는 이름·직급 (2026-08-16).
 * 🔴 **본문이 아니다.** 팀장이 「계정 Gp8M3A…」 대신 사람을 알아보고 권한을 주기 위한 값이며,
 *    사용자가 직접 입력한 자기 정보다. 길이 상한으로 본문이 이름을 가장해 들어오는 것을 막는다.
 */
const MAX_PROFILE_FIELD = 30;

function cleanProfileField(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text.slice(0, MAX_PROFILE_FIELD);
}
/** 한 번에 올릴 수 있는 날짜 수 — 무한 루프가 난 클라이언트가 문서를 폭주시키지 못하게 막는다. */
const MAX_BATCH_DAYS = 31;

export class TeamError extends Error {
  constructor(status, reason) {
    super(`team:${reason}`);
    this.status = status;
    this.reason = reason;
  }
}

/**
 * 🔴 `Math.random()`을 쓰지 않는다 — 초대 코드는 **추측되면 안 되는 값**이다.
 *    `crypto.randomInt`는 Node 22 내장이라 새 의존성이 없다.
 */
function generateCode(randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * `Bearer <idToken>` → uid. 🔴 토큰이 없거나 위조면 여기서 끝난다.
 *
 * 🔴 **`refineV1`도 이 함수를 쓴다**(2026-08-17, `functions/index.js`). 토큰 검증을 두 벌
 *    두지 않는다 — 한쪽만 고치면 한쪽이 뚫린 채로 남는다. 그래서 export한다.
 */
export async function requireUid(req, deps) {
  return (await requireAuth(req, deps)).uid;
}

/** `Bearer <idToken>` → `{uid, email}`. 🔴 토큰이 없거나 위조면 여기서 끝난다. */
async function requireAuth(req, deps) {
  const header = req.get?.('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token === '') throw new TeamError(401, 'no-token');
  try {
    const decoded = await deps.verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    throw new TeamError(401, 'bad-token');
  }
}

/** 팀원 문서를 읽고 없으면 403. 역할 판정의 단일 출처다. */
async function requireMember(db, teamId, uid) {
  const snap = await db.collection('teams').doc(teamId).collection('members').doc(uid).get();
  if (!snap.exists) throw new TeamError(403, 'not-a-member');
  return snap;
}

/**
 * 🔴 **팀장만 할 수 있는 일의 관문.** 팀 관리·팀원 목록·권한 변경이 전부 여기를 지난다 —
 *    호출부마다 역할을 검사하면 언젠가 한 곳에서 빠뜨린다.
 */
async function requireOwner(db, teamId, uid) {
  const member = await requireMember(db, teamId, uid);
  if (member.get('role') !== 'owner') throw new TeamError(403, 'not-owner');
  return member;
}

function cleanTeamName(value) {
  const name = String(value ?? '').trim();
  if (name === '' || name.length > MAX_TEAM_NAME) throw new TeamError(400, 'bad-name');
  return name;
}

/**
 * 카운트 정규화.
 * 🔴 **화이트리스트 밖은 버린다.** 클라이언트가 보낸 객체를 그대로 쓰면 언젠가 본문이 든 필드가
 *    실려 온다. 음수·소수·거대값도 여기서 막는다 — 규칙만으로는 못 막는 것들이다.
 */
function sanitizeCounts(raw) {
  const out = {};
  let total = 0;
  for (const key of COUNT_KEYS) {
    const value = raw?.[key];
    const count = Number.isInteger(value) && value >= 0 && value <= 10000 ? value : 0;
    if (count > 0) out[key] = count;
    total += count;
  }
  return { counts: out, total };
}

function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * 팀을 만든다. 만든 사람이 첫 팀원이 된다.
 * @returns {{teamId: string, name: string, inviteCode: string, role: string}}
 */
export async function createTeam(req, deps) {
  // 🔴 팀장도 이메일을 남긴다 — 없으면 팀 관리 화면에서 팀장 본인이 「계정 nejr2c…」로 보인다.
  const { uid, email } = await requireAuth(req, deps);
  const name = cleanTeamName(req.body?.name);
  const db = deps.db();

  /**
   * 🔴 코드 충돌을 무시하지 않는다. 31^6이라 확률은 낮지만, 충돌하면 **두 팀이 같은 코드를
   *    갖게 되고** 참가자가 남의 팀에 들어간다. 트랜잭션으로 유일성을 보장한다.
   */
  const teamRef = db.collection('teams').doc();
  let inviteCode = '';
  await db.runTransaction(async (tx) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateCode(deps.randomInt);
      const taken = await tx.get(db.collection('teams').where('inviteCode', '==', candidate).limit(1));
      if (taken.empty) {
        inviteCode = candidate;
        break;
      }
    }
    if (inviteCode === '') throw new TeamError(503, 'code-exhausted');

    tx.set(teamRef, {
      name,
      inviteCode,
      ownerUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(teamRef.collection('members').doc(uid), {
      role: 'owner',
      // 🔴 사람을 알아볼 수 있게 스스로 밝힌 이름·직급을 함께 남긴다(uid만으로는 못 고른다).
      displayName: cleanProfileField(req.body?.displayName),
      jobTitle: cleanProfileField(req.body?.jobTitle),
      // 🔴 팀장은 항상 대시보드를 본다 — 이 플래그로 자기 자신을 막을 수 있으면 팀에
      //    관리자가 없어진다(아래 `setPermission`도 팀장 자신은 바꾸지 못하게 한다).
      canViewDashboard: true,
      email,
      joinedAt: FieldValue.serverTimestamp(),
    });
  });

  return { teamId: teamRef.id, name, inviteCode, role: 'owner', canViewDashboard: true };
}

/**
 * 초대 코드로 참가한다.
 * 🔴 **틀린 코드와 없는 팀을 같은 응답으로 돌려준다** — 나뉘면 코드 존재 여부를 물어보는
 *    탐색 도구가 된다.
 */
export async function joinTeam(req, deps) {
  const { uid, email } = await requireAuth(req, deps);
  const code = String(req.body?.inviteCode ?? '').trim().toUpperCase();
  if (code.length !== CODE_LENGTH) throw new TeamError(404, 'bad-code');

  const db = deps.db();
  const found = await db.collection('teams').where('inviteCode', '==', code).limit(1).get();
  if (found.empty) throw new TeamError(404, 'bad-code');

  const team = found.docs[0];
  const memberRef = team.ref.collection('members').doc(uid);
  const existing = await memberRef.get();

  /**
   * 🔴 **이미 팀원이면 역할·권한을 덮어쓰지 않는다.** 그냥 두면 팀장이 자기 초대 코드로 다시
   *    참가했을 때 `role: 'member'`로 강등되어 **팀에 관리자가 없어진다.**
   * 🔴 `email`은 팀장이 팀원 목록에서 **누가 누구인지 알아보라고** 저장한다. uid만으로는
   *    권한을 줄 대상을 고를 수 없다. 🔴 이것은 마찰 지표와 완전히 분리된 데이터다 —
   *    마찰 문서에는 여전히 개인 식별자가 들어가지 않는다(필수 9).
   */
  const profile = {
    displayName: cleanProfileField(req.body?.displayName),
    jobTitle: cleanProfileField(req.body?.jobTitle),
  };
  await memberRef.set(
    existing.exists
      ? // 🔴 재참가 때는 이름·직급만 갱신한다 — 역할·권한은 그대로 둔다(강등 사고 방지).
        { email, ...profile, joinedAt: existing.get('joinedAt') ?? FieldValue.serverTimestamp() }
      : {
          role: 'member',
          ...profile,
          // 🔴 기본은 **못 본다**. 대시보드는 팀 전체의 마찰이 보이는 화면이라, 참가하면
          //    자동으로 열리는 쪽이 아니라 팀장이 열어 주는 쪽이 기본이어야 한다.
          canViewDashboard: false,
          email,
          joinedAt: FieldValue.serverTimestamp(),
        },
    { merge: true },
  );

  const after = await memberRef.get();
  // 🔴 `inviteCode`를 응답에 싣지 않는다 — 참가자가 코드를 재배포할 수 있게 만들 이유가 없다.
  return {
    teamId: team.id,
    name: team.get('name'),
    role: after.get('role') ?? 'member',
    canViewDashboard: after.get('canViewDashboard') === true,
  };
}

/**
 * 팀원 목록 (팀장 전용).
 * 🔴 **팀장만 본다.** 팀원 명단은 "누가 이 팀에 있는지"라는 인적 정보라, 권한을 주는 사람만
 *    필요하다. 팀원 전체에게 열면 관리 기능이 아니라 사내 주소록이 된다.
 */
export async function listMembers(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  if (teamId === '') throw new TeamError(400, 'no-team');

  const db = deps.db();
  await requireOwner(db, teamId, uid);

  const snap = await db.collection('teams').doc(teamId).collection('members').get();
  return {
    members: snap.docs.map((doc) => ({
      uid: doc.id,
      role: doc.get('role') ?? 'member',
      canViewDashboard: doc.get('canViewDashboard') === true,
      displayName: doc.get('displayName') ?? null,
      jobTitle: doc.get('jobTitle') ?? null,
      email: doc.get('email') ?? null,
      isMe: doc.id === uid,
    })),
  };
}

/**
 * 팀원의 대시보드 열람 권한을 바꾼다 (팀장 전용).
 *
 * 🔴 **팀장 자신은 바꾸지 못한다.** 스스로 권한을 끄면 팀에 대시보드를 볼 사람이 없어지고,
 *    되돌릴 화면도 그 대시보드 안에 있다. 되돌릴 수 없는 조작은 애초에 막는다.
 * 🔴 역할(`role`) 자체는 이 엔드포인트로 바꾸지 않는다 — 팀장 이양은 되돌리기 어려운 조작이라
 *    별도 확인 흐름이 필요하다. 지금 필요한 것은 열람 권한뿐이다.
 */
export async function setMemberPermission(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  const targetUid = String(req.body?.uid ?? '').trim();
  const canView = req.body?.canViewDashboard === true;
  if (teamId === '' || targetUid === '') throw new TeamError(400, 'bad-request');
  if (targetUid === uid) throw new TeamError(400, 'cannot-change-self');

  const db = deps.db();
  await requireOwner(db, teamId, uid);

  const targetRef = db.collection('teams').doc(teamId).collection('members').doc(targetUid);
  const target = await targetRef.get();
  if (!target.exists) throw new TeamError(404, 'no-such-member');

  await targetRef.set({ canViewDashboard: canView }, { merge: true });
  return { uid: targetUid, canViewDashboard: canView };
}

/**
 * 내 소속·권한을 확인한다.
 * 🔴 로컬(`chrome.storage`)의 값은 **참가 시점의 스냅샷**이라, 팀장이 나중에 권한을 바꿔도
 *    모른다. 대시보드를 열기 전에 서버에 다시 물어야 "권한이 없는데 열리는" 상태가 안 생긴다.
 */
export async function whoAmI(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  if (teamId === '') throw new TeamError(400, 'no-team');

  const db = deps.db();
  const teamRef = db.collection('teams').doc(teamId);
  const member = await requireMember(db, teamId, uid);

  /**
   * 🔴 **팀을 만든 사람은 팀장으로 되돌린다** (2026-08-15 실측 후 추가).
   *    실확장에서 팀을 만든 본인에게 「팀장에게 요청해 주세요」가 떴다. 원인은 예전 `joinTeam`이
   *    재참가 시 `role`을 무조건 `'member'`로 덮어썼기 때문이다 — 팀장이 자기 초대 코드를
   *    시험해 보면 **스스로 강등되고 팀에 관리자가 사라진다.** 덮어쓰기는 이미 막았지만
   *    (그 코드 주석 참고) **이미 강등된 문서는 그대로 남는다.**
   * 🔴 진실의 출처는 팀 문서의 `ownerUid`다 — 팀원 문서는 고쳐질 수 있어도 이건 생성 시 한 번
   *    쓰이고 바뀌지 않는다. 복구는 **팀장 방향으로만** 일어난다(팀원을 팀장으로 올리는 경로는
   *    없다).
   */
  const team = await teamRef.get();
  const isFounder = team.exists && team.get('ownerUid') === uid;
  const role = member.get('role') ?? 'member';
  if (isFounder && role !== 'owner') {
    await teamRef.collection('members').doc(uid).set(
      { role: 'owner', canViewDashboard: true },
      { merge: true },
    );
    return { role: 'owner', canViewDashboard: true, repaired: true };
  }

  return {
    role,
    // 팀장은 플래그와 무관하게 항상 본다 — 옛 문서에는 이 필드가 아예 없다.
    canViewDashboard: role === 'owner' || member.get('canViewDashboard') === true,
  };
}

/**
 * 마찰·긍정 카운트를 팀 문서에 더한다.
 *
 * 🔴 **더하기(increment)로만 쓴다.** 덮어쓰면 여러 팀원이 동시에 올릴 때 마지막 사람 것만 남는다.
 * 🔴 문서 id를 `{teamId}_{dateKey}`로 고정한다 — 날짜별 한 문서라 무한히 늘지 않고, 규칙이
 *    `resource.data.teamId`로 팀원 여부를 확인할 수 있다.
 */
export async function recordFriction(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  if (teamId === '') throw new TeamError(400, 'no-team');

  const db = deps.db();
  // 🔴 **올리는 것은 모든 팀원이 한다.** 대시보드 열람 권한과 무관하다 — 권한 없는 팀원의
  //    카운트가 빠지면 지표가 팀 전체를 대표하지 못한다.
  await requireMember(db, teamId, uid);

  const days = Array.isArray(req.body?.days) ? req.body.days.slice(0, MAX_BATCH_DAYS) : [];
  const accepted = [];
  const batch = db.batch();
  for (const day of days) {
    if (!isDateKey(day?.dateKey)) continue;
    const { counts, total } = sanitizeCounts(day.counts);
    if (total === 0) continue;
    const ref = db.collection('frictionCounts').doc(`${teamId}_${day.dateKey}`);
    batch.set(
      ref,
      {
        teamId,
        dateKey: day.dateKey,
        // 🔴 기여자 uid를 남기지 않는다 — 개인 단위로 분해되는 순간 만들지 않기로 한 데이터가 된다.
        ...Object.fromEntries(
          Object.entries(counts).map(([key, value]) => [key, FieldValue.increment(value)]),
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    accepted.push({ dateKey: day.dateKey, counts });
  }
  if (accepted.length > 0) await batch.commit();

  // 🔴 **무엇이 반영됐는지 그대로 돌려준다** — 클라이언트는 이 응답만큼만 로컬에서 뺀다.
  //    "성공했으니 다 지워"로 하면 서버가 버린 항목이 조용히 사라진다.
  return { accepted };
}

/**
 * 팀원을 내보낸다 (팀장 전용).
 *
 * 🔴 **팀장 자신은 못 나간다.** 나가면 관리자가 없는 팀이 남고, 되돌릴 화면이 그 안에 있다.
 *    팀을 떠나려면 먼저 `transfer`로 이양해야 한다.
 * 🔴 **내보내도 그 사람이 이미 올린 지표는 남는다.** 마찰 문서는 팀 단위 합계이고 기여자
 *    식별자가 없어서(필수 9) 특정인의 몫만 빼는 것이 **원리적으로 불가능**하다. 화면 문구가
 *    이 사실을 말해야 "지웠는데 왜 숫자가 그대로냐"가 안 생긴다.
 */
export async function removeMember(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  const targetUid = String(req.body?.uid ?? '').trim();
  if (teamId === '' || targetUid === '') throw new TeamError(400, 'bad-request');
  if (targetUid === uid) throw new TeamError(400, 'cannot-change-self');

  const db = deps.db();
  await requireOwner(db, teamId, uid);

  const targetRef = db.collection('teams').doc(teamId).collection('members').doc(targetUid);
  if (!(await targetRef.get()).exists) throw new TeamError(404, 'no-such-member');
  await targetRef.delete();
  return { uid: targetUid, removed: true };
}

/**
 * 팀장을 넘긴다 (팀장 전용).
 *
 * 🔴 **이게 없으면 팀장이 연결을 끊는 순간 관리자가 영영 없어진다** — 초대 코드도 볼 수 없고
 *    권한도 줄 수 없는 팀이 남는다. 내보내기보다 급한 기능이다.
 * 🔴 **`ownerUid`를 함께 옮긴다.** `whoAmI`의 자동 복구가 이 값을 진실의 출처로 쓰므로,
 *    안 옮기면 다음 접속에서 **옛 팀장이 다시 팀장으로 복구**되어 이양이 되돌아간다.
 * 🔴 원자적으로 처리한다 — 중간에 끊기면 팀장이 둘이거나 없는 상태가 남는다.
 */
export async function transferOwnership(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  const targetUid = String(req.body?.uid ?? '').trim();
  if (teamId === '' || targetUid === '') throw new TeamError(400, 'bad-request');
  if (targetUid === uid) throw new TeamError(400, 'cannot-change-self');

  const db = deps.db();
  await requireOwner(db, teamId, uid);
  const teamRef = db.collection('teams').doc(teamId);
  const targetRef = teamRef.collection('members').doc(targetUid);
  if (!(await targetRef.get()).exists) throw new TeamError(404, 'no-such-member');

  const batch = db.batch();
  batch.set(targetRef, { role: 'owner', canViewDashboard: true }, { merge: true });
  /**
   * 🔴 옛 팀장은 **팀원으로 남는다**(쫓아내지 않는다).
   * 🔴 **대시보드 열람은 꺼진다** (2026-08-16 사용자 지시로 변경). 예전에는 `true`로 남겼는데
   *    — "갑자기 안 보이면 사고다"라는 이유였다 — 그러면 **팀장을 넘긴 사람이 아무 설정 없이
   *    계속 팀 전체 지표를 본다.** 이 제품의 기본은 「참가하면 자동으로 열리는 쪽이 아니라
   *    팀장이 열어 주는 쪽」이고(아래 `setMemberPermission` 주석), 이양은 **권한을 내려놓는
   *    행위**이므로 다른 팀원과 같은 기본값이어야 한다. 새 팀장이 다시 켜 줄 수 있다.
   */
  batch.set(
    teamRef.collection('members').doc(uid),
    { role: 'member', canViewDashboard: false },
    { merge: true },
  );
  batch.set(teamRef, { ownerUid: targetUid }, { merge: true });
  await batch.commit();

  return { ownerUid: targetUid, role: 'member', canViewDashboard: false };
}

/**
 * 초대 코드를 새로 발급한다 (팀장 전용).
 * 🔴 **유출됐을 때 복구 경로가 이것뿐이다.** 옛 코드는 즉시 무효가 된다 — 아직 안 들어온
 *    사람에게는 새 코드를 다시 줘야 한다는 사실을 화면이 말해야 한다.
 */
export async function regenerateInvite(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  if (teamId === '') throw new TeamError(400, 'no-team');

  const db = deps.db();
  await requireOwner(db, teamId, uid);
  const teamRef = db.collection('teams').doc(teamId);

  let inviteCode = '';
  await db.runTransaction(async (tx) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateCode(deps.randomInt);
      const taken = await tx.get(
        db.collection('teams').where('inviteCode', '==', candidate).limit(1),
      );
      if (taken.empty) {
        inviteCode = candidate;
        break;
      }
    }
    if (inviteCode === '') throw new TeamError(503, 'code-exhausted');
    tx.set(teamRef, { inviteCode }, { merge: true });
  });

  return { inviteCode };
}

/** 팀 이름을 바꾼다 (팀장 전용). */
export async function renameTeam(req, deps) {
  const uid = await requireUid(req, deps);
  const teamId = String(req.body?.teamId ?? '').trim();
  if (teamId === '') throw new TeamError(400, 'no-team');
  const name = cleanTeamName(req.body?.name);

  const db = deps.db();
  await requireOwner(db, teamId, uid);
  await db.collection('teams').doc(teamId).set({ name }, { merge: true });
  return { teamId, name };
}

/** 라우팅 표 — `functions/index.js`가 이 표만 보고 부른다. */
export const TEAM_ACTIONS = {
  create: createTeam,
  join: joinTeam,
  friction: recordFriction,
  members: listMembers,
  permission: setMemberPermission,
  me: whoAmI,
  kick: removeMember,
  transfer: transferOwnership,
  reinvite: regenerateInvite,
  rename: renameTeam,
};

/** 기본 의존성. 테스트는 이 셋을 전부 대체해 네트워크 없이 돈다. */
export function defaultDeps() {
  return {
    db: () => getFirestore(),
    verifyIdToken: (token) => getAuth().verifyIdToken(token),
    randomInt,
  };
}
