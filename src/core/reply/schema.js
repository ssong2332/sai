/**
 * 회신 초안 응답 검증·정규화 (S37).
 *
 * 🔴 Zero Retention (Spec 필수 5): 본문 문자열을 로그·저장소로 내보내지 않는다.
 * 🔴 `draft`가 없으면 result:null이다 — 회신 초안 기능에서 초안이 없는 응답은 아무 값이 없다.
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function asString(value, fallback = '') {
  return isNonEmptyString(value) ? value : fallback;
}

/**
 * @param {object} raw 파싱된 LLM JSON.
 * @returns {{result: object|null, issues: string[]}}
 */
export function normalizeReplyResponse(raw) {
  const issues = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { result: null, issues: ['response:not-an-object'] };
  }
  if (!isNonEmptyString(raw.draft)) {
    return { result: null, issues: ['draft:missing'] };
  }
  /**
   * 🔴 v5부터 초안은 **하나**다 — 사용자의 모국어 초안. 외국어로 옮기는 일은 「다듬기」가 맡으므로
   *    여기서 번역본을 받지 않는다(`prompt.js` v5 주석).
   */

  return {
    result: {
      draft: raw.draft,
      placeholderNote: asString(raw.placeholderNote, ''),
      fallback: false,
      fallbackReason: null,
      cached: false,
    },
    issues,
  };
}
