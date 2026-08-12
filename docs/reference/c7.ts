/**
 * C7 결정사항 자동 요약 프롬프트 — 텍스트와 `PROMPT_VERSION`을 같은 곳에 둔다
 * (`docs/Architecture.md` Folder Structure "prompts/ # 프롬프트 텍스트 + PROMPT_VERSION 상수").
 * `packages/core/src/prompts/c6.ts`와 같은 패턴이다.
 *
 * 🔴 `PROMPT_VERSION`은 캐시 키(`llm_cache.cache_key`)에 들어간다 — 이 프롬프트(아래
 * `instruction` 문자열)를 고치면 반드시 이 값을 올린다(`docs/Architecture.md` Conventions 10).
 *
 * `apps/web/lib/llm/openai.ts`는 시스템 메시지를 따로 만들지 않고 payload 전체를 단일 user
 * 메시지의 JSON 본문으로 보낸다 — 그래서 지시문(`instruction`)을 payload 안에 담는다(`prompts/c4.ts`
 * 헤더 주석 참조).
 *
 * ## 이 프롬프트가 한 번의 호출로 산출하는 것
 * `decisions[]`(결정 내용/담당자/기한, AC-019/AC-020) + 결정 항목마다의 `authorityStatus`/
 * `authorityEvidence`(AC-050/AC-064②) — 추가 LLM 호출을 만들지 않는다(C6와 같은 설계 판단).
 *
 * 🔴 미확정 감지(`unresolved[]`, AC-038)는 이 프롬프트가 묻지 않는다 — `steps/c7.ts`가 파싱된
 * `decisions[]`에서 `owner`/`dueDate`가 `null`인 항목을 결정적으로 골라낸다(그 파일 헤더 주석
 * 참조). LLM에게 별도로 물으면 두 배열이 서로 어긋날 위험이 생긴다.
 *
 * 🔴 AC-020 — 담당자·기한은 원문에 근거가 없으면 반드시 `null`이며 임의 생성을 금지한다고
 * 명시한다.
 * 🔴 AC-050①/AC-064⑤ — `authorityStatus`는 근거가 없으면 반드시 `"불명"`이며 임의 판정을
 * 금지한다고 명시한다. 최종 불변식 강제는 `packages/core/src/rules/decision-authority.ts`의
 * `resolveAuthority()`가 한다(이 프롬프트는 모델에게 규칙을 알려줄 뿐, 강제는 코드가 한다).
 */

/** 🔴 프롬프트 문구를 바꾸면 이 값을 올린다. */
export const C7_PROMPT_VERSION = 'c7-v1';

export interface C7Payload {
  instruction: string;
  text: string;
}

const RESPONSE_FORMAT_RULE =
  'Respond with JSON only, matching exactly this shape: {"decisions": [{"decision": "<the concrete ' +
  'decision/agreement stated in the thread>", "owner": "<the person responsible, if the thread gives ' +
  'textual evidence>" | null, "dueDate": "<the deadline, if the thread gives textual evidence>" | ' +
  'null, "authorityStatus": "확정" | "내부 승인 필요" | "검토 중" | "불명", "authorityEvidence": ' +
  '"<a sentence, in the same language as the input, quoting or closely paraphrasing the textual ' +
  'evidence for the chosen authorityStatus value>" | null}, ...]}. If the thread contains no ' +
  'decisions at all, respond with {"decisions": []} — an empty array is a valid, correct answer, not ' +
  'an error. Do not add any text outside the JSON object.';

const DECISION_RULE =
  'Read the conversation thread given in "text" and extract every concrete decision or agreement ' +
  'reached in it as one entry in "decisions". For each decision, identify "owner" (who is ' +
  'responsible for carrying it out) and "dueDate" (when it is due) ONLY if the thread gives real ' +
  'textual evidence — never guess or infer a plausible-sounding owner or date that is not actually ' +
  'stated or clearly implied by the text. If the thread gives no evidence for "owner" and/or ' +
  '"dueDate" for a given decision, set that field to null instead of inventing a value. If the ' +
  'thread contains no decisions at all, "decisions" MUST be an empty array — do not fabricate a ' +
  'decision to avoid returning an empty list.';

const AUTHORITY_RULE =
  'For EACH decision, separately assess whether the text gives textual evidence about who holds ' +
  'decision-making authority over that specific matter, and classify it as exactly one of: "확정" ' +
  '(the text states the matter is already decided/approved), "내부 승인 필요" (the text states or ' +
  'implies that internal approval from someone else is still needed), "검토 중" (the text states or ' +
  'implies the matter is still being reviewed/considered), or "불명" (the text gives no real evidence ' +
  'either way). Never guess: if there is no textual basis, answer "불명". When you answer "불명", ' +
  '"authorityEvidence" must be null. When you answer one of the other three values, ' +
  '"authorityEvidence" must be a non-empty sentence pointing to the specific textual basis for THAT ' +
  'decision — never leave it null while claiming a determined status, and never invent evidence that ' +
  'is not actually in the text.';

/**
 * C7 결정사항 요약 요청 payload를 만든다.
 *
 * @param threadText 요약할 대화 스레드 원문.
 */
export function buildC7Payload(threadText: string): C7Payload {
  const instruction = [
    'You are summarizing a conversation thread into a table of decisions, one row per decision, ' +
      'for a party who was not present in the conversation. Do not invent decisions, owners, due ' +
      'dates, or evidence that are not in the original text.',
    DECISION_RULE,
    AUTHORITY_RULE,
    RESPONSE_FORMAT_RULE,
  ].join(' ');

  return { instruction, text: threadText };
}
