/**
 * 「기본 톤」 ↔ 「협업 성향」 한 번 맞추기 (2026-10-25 사용자 결정 — 「화면에 보이는 값이 이긴다」).
 *
 * 왜: 「협업 성향」 칩을 화면에서 없애고 말투를 「기본 톤」(`sai.onboarding.tone`) 하나로 합쳤다. 그런데 예전 화면에서
 *    협업 성향을 따로 바꿔 둔 사람은 `sai.profile.collabStyleId`가 톤과 다를 수 있다 — 그러면 화면은 기본 톤을
 *    보여 주는데 교정 요청(`buildProfileForRefine`)에는 예전 협업 성향이 실린다. 그 어긋남을 한 번 없앤다.
 *
 * 판정표 (`reconcileToneProfile`):
 * | onboarding.tone | profile.collabStyleId | 결과 |
 * |---|---|---|
 * | 유효한 id(`DEFAULT_TONES`) | 다르거나 null | `{collabStyleId: tone}` — 프로필을 톤에 맞춘다 |
 * | 유효한 id | 같음 | null — 할 일 없음 |
 * | 비었거나 목록 밖 | 무엇이든 | null — 화면에 보이는 톤이 없으므로 건드리지 않는다 |
 *
 * 🔴 `onboarding`은 쓰지 않는다 — 프로필만 `setProfile`로 바꾼다. 몇 번을 돌려도 결과가 같다(멱등).
 * 🔴 로컬에서만 일어난다(네트워크 없음). 다만 프로필은 로그인한 사용자의 **다음 동기화** 때 `syncClient`가 서버로
 *    올린다 — 그건 원래 동작이고 기대한 결과다(올라가는 것은 고정 id 하나, 본문 아님 — Zero Retention 무관).
 */

import { DEFAULT_TONES, getOnboarding } from './onboarding.js';
import { getProfile, setProfile } from './profile.js';

const TONE_IDS = DEFAULT_TONES.map((item) => item.id);

/**
 * @param {{tone?: unknown}|null|undefined} onboarding
 * @param {{collabStyleId?: unknown}|null|undefined} profile
 * @returns {{collabStyleId: string} | null} 프로필에 적용할 패치, 할 일이 없으면 null
 */
export function reconcileToneProfile(onboarding, profile) {
  const tone = onboarding?.tone;
  if (typeof tone !== 'string' || !TONE_IDS.includes(tone)) return null;
  if ((profile?.collabStyleId ?? null) === tone) return null;
  return { collabStyleId: tone };
}

/** 저장값을 읽어 판정하고, 필요하면 프로필만 고친다. @returns {Promise<boolean>} 고쳤으면 true */
export async function runToneReconcile() {
  const [onboarding, profile] = await Promise.all([getOnboarding(), getProfile()]);
  const patch = reconcileToneProfile(onboarding, profile);
  if (!patch) return false;
  await setProfile(patch);
  return true;
}
