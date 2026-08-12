/**
 * C6 하소연 → 태스크 티켓 변환 프롬프트 — 텍스트와 `PROMPT_VERSION`을 같은 곳에 둔다
 * (`docs/Architecture.md` Folder Structure "prompts/ # 프롬프트 텍스트 + PROMPT_VERSION 상수").
 * `packages/core/src/prompts/c1.ts`·`c2.ts`·`c4.ts`와 같은 패턴이다.
 *
 * 🔴 `PROMPT_VERSION`은 캐시 키(`llm_cache.cache_key`)에 들어간다 — 이 프롬프트(아래
 * `instruction` 문자열)를 고치면 반드시 이 값을 올린다(`docs/Architecture.md` Conventions 10).
 *
 * `apps/web/lib/llm/openai.ts`는 시스템 메시지를 따로 만들지 않고 payload 전체를 단일 user
 * 메시지의 JSON 본문으로 보낸다 — 그래서 지시문(`instruction`)을 payload 안에 담는다(`prompts/c4.ts`
 * 헤더 주석 참조).
 *
 * ## 이 프롬프트가 한 번의 호출로 산출하는 것
 * `sections`(4개, AC-017/AC-062) / `decisionAuthority` + `decisionAuthorityEvidence`
 * (AC-050/AC-064①) — 추가 LLM 호출을 만들지 않는다.
 *
 * 🔴 AC-062 — 4개 섹션은 근거 유무와 무관하게 항상 존재해야 하고, 근거가 없는 섹션은 빈 문자열이나
 * 생략이 아니라 문자열 `"없음"`으로 채우도록 프롬프트에서 명시적으로 지시한다.
 * 🔴 AC-018 — [우려 수준](`concernLevel`)은 원문의 감정을 삭제하는 것이 아니라 메타 정보로
 * "보존"하라고 명시한다.
 * 🔴 AC-050①/AC-064⑤ — `decisionAuthority`는 근거가 없으면 반드시 `"불명"`이며 임의 판정을
 * 금지한다고 명시한다. 최종 불변식 강제는 `packages/core/src/rules/decision-authority.ts`의
 * `resolveAuthority()`가 한다(이 프롬프트는 모델에게 규칙을 알려줄 뿐, 강제는 코드가 한다).
 */

/** 🔴 프롬프트 문구를 바꾸면 이 값을 올린다. */
export const C6_PROMPT_VERSION = 'c6-v1';

export interface C6Payload {
  instruction: string;
  text: string;
}

const RESPONSE_FORMAT_RULE =
  'Respond with JSON only, matching exactly this shape: {"sections": {"problem": "<one or more ' +
  'sentences describing the concrete problem, or the exact string "없음" if the text gives no basis ' +
  'for it>", "impact": "<the stated or clearly implied impact/risk, or "없음">", "request": ' +
  '"<the concrete ask/action requested, or "없음">", "concernLevel": "<a description that preserves ' +
  'the emotional intensity of the original text as metadata — do not delete or neutralize it — or ' +
  '"없음" if the text carries no discernible emotional intensity>"}, "decisionAuthority": "확정" | ' +
  '"내부 승인 필요" | "검토 중" | "불명", "decisionAuthorityEvidence": "<a sentence, in the same ' +
  'language as the input, quoting or closely paraphrasing the textual evidence for the chosen ' +
  'decisionAuthority value>" | null}. Do not add any text outside the JSON object.';

const SECTION_RULE =
  'Restructure the venting/complaint message given in "text" into exactly four sections: ' +
  '"problem" (문제 정의 — what the concrete problem is), "impact" (영향·리스크 — the stated or ' +
  'clearly implied consequence/risk of not addressing it), "request" (요청 사항 — the concrete ' +
  'action or response being asked for), and "concernLevel" (우려 수준 — a description that ' +
  'preserves, not deletes, the emotional intensity carried by the original wording, e.g. how ' +
  'frustrated/urgent/upset the writer sounds). All four sections MUST always be present as non-empty ' +
  'strings in the response — never omit a key and never return an empty string. If the text gives no ' +
  'real basis for a given section, set that section to the exact string "없음" instead of inventing ' +
  'content — never fabricate a problem, impact, request, or concern level that is not actually ' +
  'supported by the text.';

const AUTHORITY_RULE =
  'Separately, assess whether the text gives textual evidence about who holds decision-making ' +
  'authority over this matter, and classify it as exactly one of: "확정" (the text states the ' +
  'matter is already decided/approved), "내부 승인 필요" (the text states or implies that internal ' +
  'approval from someone else is still needed), "검토 중" (the text states or implies the matter is ' +
  'still being reviewed/considered), or "불명" (the text gives no real evidence either way). Never ' +
  'guess: if there is no textual basis, answer "불명". When you answer "불명", ' +
  '"decisionAuthorityEvidence" must be null. When you answer one of the other three values, ' +
  '"decisionAuthorityEvidence" must be a non-empty sentence pointing to the specific textual basis — ' +
  'never leave it null while claiming a determined status, and never invent evidence that is not ' +
  'actually in the text.';

/**
 * C6 티켓 변환 요청 payload를 만든다.
 *
 * @param text 하소연/불만이 섞인 원문.
 */
export function buildC6Payload(text: string): C6Payload {
  const instruction = [
    'You are restructuring a venting/complaint work message into a structured task ticket while ' +
      'preserving — not deleting — its emotional intensity as metadata. Do not invent facts, ' +
      'sections, or evidence that are not in the original text.',
    SECTION_RULE,
    AUTHORITY_RULE,
    RESPONSE_FORMAT_RULE,
  ].join(' ');

  return { instruction, text };
}
