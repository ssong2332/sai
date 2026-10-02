/**
 * `[🚨 URGENT]` 태그 (S24 / Spec 부가 2) — 붙이고 떼는 규칙의 단일 출처.
 *
 * 🔴 **왜 파일로 뺐나 (2026-10-02 버그).** 팝업이 적용할 문장 앞에 태그를 붙이고, 오버레이는 그 문장을
 *    AI 교정문과 비교해 「사용자가 고쳤는가」를 판정한다(S13 학습). 태그만 붙은 문장을 «고친 것»으로
 *    읽어서, 아무것도 안 고쳤는데 「이번 수정은 학습되지 않았어요」가 떴다. 붙이는 쪽과 비교하는 쪽이
 *    같은 규칙을 써야 한다.
 */
export const URGENT_PREFIX = '[🚨 URGENT] ';

export function withUrgentPrefix(text) {
  return text.startsWith(URGENT_PREFIX) ? text : `${URGENT_PREFIX}${text}`;
}

export function stripUrgentPrefix(text) {
  return typeof text === 'string' && text.startsWith(URGENT_PREFIX) ? text.slice(URGENT_PREFIX.length) : text;
}

/**
 * 학습(S13)에 넘길 「사용자가 실제로 고친 문장」. 태그를 떼고 비교해 같으면 `null` — 고친 게 없다.
 * @returns {string | null}
 */
export function editedTextForLearning(aiText, appliedText) {
  if (!aiText || !appliedText) return null;
  const edited = stripUrgentPrefix(appliedText);
  return edited === aiText ? null : edited;
}
