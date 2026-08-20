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

/**
 * 개인 협업 성향 고정 집합 (Spec 필수 2 1순위 "개인 협업 성향").
 *
 * 🔴 **「결론 먼저」·「근거를 함께」를 더했다** (2026-08-20 사용자 결정 ⓑ). 기존 3개에는
 *    **「구조」 축이 통째로 없었다** — 결론을 먼저 낼지 배경을 먼저 깔지는 다른 나라 기업과
 *    일할 때 가장 자주 부딪히는 지점인데 설정할 방법이 없었다.
 *
 * 🔴 **여전히 단일 선택이고, 그래서 축이 섞여 있다**(강도: 직접적으로↔부드럽게 / 길이: 짧게 /
 *    구조: 결론 먼저·근거를 함께). 「부드럽지만 짧게」는 지금도 못 고른다. 축을 나눠 다중
 *    선택으로 가는 안(ⓒ)은 저장 구조·프롬프트가 바뀌어 **실호출 재검증**이 따라오므로 미뤘다.
 *
 * 🔴 **「친근하게」류를 넣지 않는다** — 다듬기 패널의 가볍게/기본/격식(`register`)과 **같은 축**이라
 *    이 프로젝트에서 두 번 겪은 「한 눈금에 버튼 두 개」 충돌이 재발한다.
 *
 * 🔴 **id는 `DEFAULT_TONES`와 같아야 한다**(`lib/onboarding.js` · 테스트가 강제). 온보딩의
 *    「기본 톤」이 그대로 이 값이 되므로, 한쪽에만 더하면 프로필에서 고른 값이 홈 요약에서
 *    **「미설정」으로 보인다.**
 * 🔴 `RECIPIENT_TAGS`의 `conclusion-first`와 **다른 값이다** — 저쪽은 「그 상대가 원하는 것」,
 *    이쪽은 「내가 쓰는 방식」이다. id를 겹치지 않게 둔다.
 */
export const COLLAB_STYLES = [
  /**
   * 🔴 **「요청이 있을 때만」이라는 조건이 빠져 있었다** (2026-08-20 사용자 실사용 제보).
   *
   *    첫 문구는 전부 `Phrase the request …`처럼 **메시지에 요청이 있다고 전제**했다. 그래서
   *    허가문 「배포하셔도 됩니다」가 「Could you proceed …?」(요청)로 뒤집혔다 — 없는 요청을
   *    모델이 만들어 낸 것이다. 말투를 끄면 `you can proceed`로 정확했다.
   * 🔴 그래서 모든 항목이 **① 요청이 있을 때 무엇을 하는지 ② 없을 때 무엇을 «하지 않는지»**를
   *    함께 말한다. 조건절 없이 지시만 주면 모델은 지시를 이행하려고 문장을 만들어 낸다.
   */
  {
    id: 'direct',
    label: '직접적으로',
    hint:
      'If the message asks for something, phrase that ask as a direct imperative statement and ' +
      'drop optional scaffolding such as "I was wondering if" or "Could you possibly". If the ' +
      'message does not ask for anything, leave its sentence type as it is — do not turn a ' +
      'statement, an approval, or a permission into an instruction.',
  },
  {
    id: 'warm',
    label: '부드럽게',
    hint:
      'If the message asks for something, phrase that ask as a polite question (for example ' +
      '"Could you ...?") rather than a bare imperative, and add one brief considerate touch such ' +
      'as a thanks or an acknowledgement. If the message does not ask for anything, keep it as a ' +
      'statement and soften only the wording — never turn a report, an approval, or a permission ' +
      'into a request.',
  },
  {
    id: 'brief',
    label: '짧게',
    hint:
      'Drop greetings, preamble, and closing pleasantries. Keep only what the message actually ' +
      'says — its point, any deadline, and anything it requires.',
  },
  {
    id: 'conclusion',
    label: '결론 먼저',
    hint:
      'Put the main point in the FIRST sentence — whether that point is a request, a conclusion, ' +
      'a decision, or an approval. Any background or context comes after it.',
  },
  {
    id: 'rationale',
    label: '근거를 함께',
    hint:
      'Include the reason in one short clause. Use only a reason that is present in the original ' +
      'text — never invent one.',
  },
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
