/**
 * 용어집 신고 대조 (L28 안전망 A, 2026-10-23 사용자 승인 설계).
 *
 * 🔴 **실측한 결함 (N-02, Claude Haiku 5.5)**: 모델이 `appliedGlossary`에
 *    g2 「김 대리님」→「Sujin Kim」을 **적용했다고 신고**했는데, 교정문은
 *    "Could you please review this when you have a moment? Your confirmation is needed." —
 *    「Sujin Kim」이 어디에도 없었다. 화면은 신고만 믿고 「용어사전 1개 적용됨」을 띄웠다.
 *    모델의 자기 신고는 증거가 아니다 — `reasoning.js`(근거 섹션)와 같은 원칙으로 **코드가 대조한다.**
 *
 * 🔴 **고쳐 쓰지 않는다. 표시만 한다.** 빠진 용어를 우리가 끼워 넣으면 어느 자리에 넣을지
 *    우리가 맞다는 근거가 없다(`names.js`·`numberCheck.js`와 같은 규칙).
 *
 * 판정표 (2026-10-23, 이 표대로만 동작한다)
 * | 항목의 상태                                        | 「적용됨」 표시 | 경고 |
 * |---|---|---|
 * | `appliedText`가 교정문에 있다 (대소문자·공백 무시) | ✅ 센다·강조   | 없음 |
 * | `appliedText`가 있는데 교정문에 없다               | ❌ 빼다        | 🔴 「용어집 「…」이(가) 교정문에 반영되지 않았어요」 |
 * | `appliedText`가 비었다                             | ❌ 빼다        | 없음 — 무엇을 찾을지 모른다(대조 불가 = 근거 없음) |
 * | 같은 `appliedText`가 여러 번 신고됐다              | 지금처럼 각각 센다 | 한 번만 |
 * | 폴백 결과                                          | ❌ (원래 빈 목록) | 없음 — 대조할 교정문이 없다 |
 *
 * 🔴 대조는 `reasoning.js` `occursIn`을 그대로 쓴다 — 「근거」 섹션과 「적용됨」 표시가 서로 다른
 *    잣대로 판정하면 한 화면에서 말이 엇갈린다.
 * 🔴 Zero Retention: 입력 문자열은 이 함수 안에서만 쓰이고 어디에도 저장·기록되지 않는다.
 */

import { occursIn } from './reasoning.js';

/**
 * @param {object|null} result `normalizeRefineResponse`의 결과.
 * @returns {{
 *   applied: Array<{id: string, sourceText: string, appliedText: string}>,
 *   missing: string[],
 * }} `applied` — 교정문에서 확인된 항목(화면의 「적용됨」·강조는 이것만 쓴다).
 *    `missing` — 신고됐지만 교정문에 없는 `appliedText`(경고용, 중복 없음).
 */
export function checkGlossaryApplied(result) {
  if (!result || typeof result !== 'object' || result.fallback) return { applied: [], missing: [] };
  const refined = String(result.refined ?? '');
  const entries = Array.isArray(result.appliedGlossary) ? result.appliedGlossary : [];

  const applied = [];
  const missing = [];
  for (const entry of entries) {
    const target = String(entry?.appliedText ?? '').trim();
    if (target === '') continue;
    if (occursIn(target, refined)) applied.push(entry);
    else if (!missing.some((m) => m.toLowerCase() === target.toLowerCase())) missing.push(target);
  }
  return { applied, missing };
}

/**
 * 화면 문구. 🔴 **왜 빠졌는지 단정하지 않는다** — 다른 표기로 바뀌었는지, 문장째 빠졌는지
 *    우리는 구분할 수 없다(`numberWarningText`와 같은 원칙).
 */
export function glossaryWarningText(missing) {
  if (!Array.isArray(missing) || missing.length === 0) return '';
  return `용어집 ${missing.map((v) => `「${v}」`).join(', ')}이(가) 교정문에 반영되지 않았어요 — 적용했다고 나왔지만 교정문에서 보이지 않아요. 보내기 전에 확인해 주세요.`;
}
