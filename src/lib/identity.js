/**
 * 내 이름·직급 (팀에서 나를 알아보게 하는 값). 2026-08-16 신설.
 *
 * 🔴 **왜 필요한가**: 팀 관리 화면에 팀원이 「계정 Gp8M3A…」로 떴다(실확장 스크린샷). 팀장이
 *    권한을 줄 대상을 고를 수 없다. 계정 이메일이 있어도 `asg21274@gmail.com` 같은 값이면
 *    누구인지 알기 어렵다.
 *
 * 🔴 **팀에 들어갈 때마다 묻지 않는다.** 여러 팀에 속할 수 있으므로 팀마다 이름을 다시 입력하게
 *    하면 같은 값을 반복해서 치게 되고, 팀마다 이름이 갈리는 사고도 난다. 한 번 설정해 두고
 *    생성·참가 시 함께 실어 보낸다.
 *
 * 🔴 **자기 정보만 담는다.** 남에 대한 값은 여기 들어가지 않는다(수신자는 `recipients.js`).
 *    저장·전송되는 것은 사용자가 직접 친 짧은 문자열 두 개뿐이다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/** 🔴 서버(`functions/teams.js`의 `MAX_PROFILE_FIELD`)와 같은 값이어야 한다. */
export const MAX_IDENTITY_FIELD = 30;

const EMPTY = { displayName: '', jobTitle: '' };

function clean(value) {
  return String(value ?? '').trim().slice(0, MAX_IDENTITY_FIELD);
}

/** @returns {Promise<{displayName: string, jobTitle: string}>} */
export async function getIdentity() {
  const stored = await getLocal(STORAGE_KEYS.IDENTITY, null);
  if (!stored || typeof stored !== 'object') return { ...EMPTY };
  return { displayName: clean(stored.displayName), jobTitle: clean(stored.jobTitle) };
}

export async function setIdentity(patch) {
  const current = await getIdentity();
  const next = {
    displayName: clean(patch?.displayName ?? current.displayName),
    jobTitle: clean(patch?.jobTitle ?? current.jobTitle),
  };
  await setLocal(STORAGE_KEYS.IDENTITY, next);
  return next;
}

/**
 * 이름이 없으면 팀에서 못 알아본다 — 팀 만들기·참가 화면이 이 값으로 안내를 띄운다.
 * 🔴 **막지는 않는다.** 이름 없이도 팀에 들어갈 수 있어야 한다(직급이 없는 조직도 있고,
 *    익명으로 참여하고 싶을 수도 있다). 권하되 강제하지 않는다.
 */
export function isIdentitySet(identity) {
  return clean(identity?.displayName) !== '';
}
