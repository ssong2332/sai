/**
 * 개인 프로필 + 학습 패턴 저장 (S13 / Spec 필수 2 · 권장 11).
 *
 * 🔴 **Zero Retention (Spec 필수 5)**: 여기 저장되는 학습 데이터는 `{카테고리 id: 횟수}` 맵뿐이다.
 *    메시지 본문·교정문·수정문은 저장하지 않는다. 화면에 보이는 문장은 `categoryLabel()`이
 *    id로부터 조립하는 표시 문자열이며 저장된 적이 없다.
 * 🔴 1순위(상황 템플릿·협업 성향)는 사용자가 직접 쓴 설정값이라 저장한다 — 이건 "메시지 본문"이
 *    아니라 설정이다(용어집·역번역 토글과 같은 계열).
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';
import { classifyEdit, selectLearnedHints } from '../core/profile/diff.js';

/**
 * 상황 템플릿 고정 집합 (Spec 필수 2 1순위 "상황(Situation) 템플릿(코드리뷰, 장애 등)").
 * 🔴 자유 입력이 아니라 고정 집합인 이유: 자유 문자열을 프롬프트에 실으면 주입 표면이 된다.
 */
export const SITUATION_TEMPLATES = [
  { id: 'code-review', label: '코드 리뷰', hint: 'The context is a code review comment.' },
  { id: 'incident', label: '장애 대응', hint: 'The context is an active incident response.' },
  { id: 'schedule', label: '일정 조율', hint: 'The context is scheduling or deadline coordination.' },
  { id: 'report', label: '진행 보고', hint: 'The context is a progress report or status update.' },
];

/** 개인 협업 성향 고정 집합 (Spec 필수 2 1순위 "개인 협업 성향"). */
export const COLLAB_STYLES = [
  { id: 'direct', label: '직접적으로', hint: 'The user prefers direct, unhedged phrasing.' },
  { id: 'warm', label: '부드럽게', hint: 'The user prefers warm, considerate phrasing.' },
  { id: 'brief', label: '짧게', hint: 'The user prefers brief messages with minimal preamble.' },
];

const EMPTY_PROFILE = { situationId: null, collabStyleId: null };

/** @returns {Promise<{situationId: string|null, collabStyleId: string|null}>} */
export async function getProfile() {
  return getLocal(STORAGE_KEYS.PROFILE, EMPTY_PROFILE);
}

export async function setProfile(patch) {
  const current = await getProfile();
  const next = { ...current, ...patch };
  await setLocal(STORAGE_KEYS.PROFILE, next);
  return next;
}

/** @returns {Promise<Record<string, number>>} 카테고리별 누적 횟수. 없으면 빈 객체. */
export async function getLearnedCounts() {
  return getLocal(STORAGE_KEYS.LEARNED_PATTERNS, {});
}

/**
 * 사용자가 교정문을 고쳐서 적용했을 때 호출한다. 판정표 A로 분류해 **횟수만** 누적한다.
 *
 * 🔴 인자로 받은 두 문자열은 여기서 소비되고 저장되지 않는다 (Zero Retention).
 *
 * @returns {Promise<{distance: number, categoryIds: string[]}>} 기록된 분류 결과(표시/로그용 아님).
 */
export async function recordEdit(aiText, userText) {
  const outcome = classifyEdit(aiText, userText);
  if (outcome.categoryIds.length === 0) return outcome;

  const counts = await getLearnedCounts();
  const next = { ...counts };
  for (const id of outcome.categoryIds) {
    next[id] = (next[id] ?? 0) + 1;
  }
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, next);
  return outcome;
}

/** 권장 11 — 개별 삭제. @returns {Promise<boolean>} 실제로 지워졌으면 true. */
export async function removeLearnedPattern(categoryId) {
  const counts = await getLearnedCounts();
  if (!(categoryId in counts)) return false;
  const next = { ...counts };
  delete next[categoryId];
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, next);
  return true;
}

/** 권장 11 — 전체 삭제. */
export async function clearLearnedPatterns() {
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, {});
}

/**
 * `/v1/refine` payload에 실을 프로필 블록을 만든다 (판정표 B).
 *
 * 🔴 국가/문화권(3순위)은 만들지 않는다 (Spec 필수 9 G1/G2).
 *
 * @returns {Promise<{situation: string|null, collabStyle: string|null, learned: {id:string,hint:string}[]}>}
 */
export async function buildProfileForRefine() {
  const [profile, counts] = await Promise.all([getProfile(), getLearnedCounts()]);
  const situation = SITUATION_TEMPLATES.find((item) => item.id === profile.situationId) ?? null;
  const collabStyle = COLLAB_STYLES.find((item) => item.id === profile.collabStyleId) ?? null;

  return {
    situation: situation?.hint ?? null,
    collabStyle: collabStyle?.hint ?? null,
    learned: selectLearnedHints(counts),
  };
}
