/**
 * 결정사항 자동 요약 프롬프트 (S25 / Spec 부가 7 — Decision Log).
 *
 * `docs/reference/c7.ts`를 이식한 것이다. 원본 주석의 설계 판단을 그대로 유지한다:
 *   - `decisions[]`와 각 항목의 `authorityStatus`/`authorityEvidence`를 **한 번의 호출로** 얻는다
 *     (추가 LLM 호출을 만들지 않는다 — decode·refine과 같은 판단).
 *   - **미확정 감지는 이 프롬프트가 묻지 않는다.** `schema.js`가 파싱된 `decisions[]`에서
 *     `owner`/`dueDate`가 `null`인 항목을 **결정적으로** 골라낸다. LLM에게 따로 물으면 두 배열이
 *     서로 어긋난다.
 *
 * 🔴 refine·decode와 캐시 키가 섞이지 않도록 별도 버전. 문구를 바꾸면 이 값을 올린다.
 */
export const DECISIONS_PROMPT_VERSION = 'decisions-v1';

/** 결정 권한 상태 — 이 네 값 외에는 스키마가 받지 않는다. */
export const AUTHORITY_STATUSES = ['확정', '내부 승인 필요', '검토 중', '불명'];

/** 근거가 없을 때의 표준값. `불명`이면 `authorityEvidence`는 반드시 null이다. */
export const AUTHORITY_UNKNOWN = '불명';

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
 * 🔴 국가·문화 단정 금지 (Spec 필수 2 3순위 · 필수 9) — 이식 원본에는 없던 규칙이다.
 *    결정 요약은 여러 나라 사람이 섞인 스레드를 읽으므로, 모델이 "○○ 문화권이라 승인이 늦다"
 *    같은 서술로 새는 경로가 실제로 있다. 텍스트에 있는 것만 쓰게 못 박는다.
 */
const NO_ATTRIBUTION_RULE =
  'Never explain a decision, an owner, a delay, or an authority status in terms of the nationality, ' +
  'country, or culture of the people in the thread. Base every field only on what the text itself ' +
  'says.';

/**
 * 결정 요약 요청 payload를 만든다.
 *
 * @param {object} input
 * @param {string} input.text 요약할 대화 스레드 원문.
 * @returns {{instruction: string, text: string}}
 */
export function buildDecisionsPayload({ text }) {
  const instruction = [
    'You are summarizing a conversation thread into a table of decisions, one row per decision, ' +
      'for a party who was not present in the conversation. Do not invent decisions, owners, due ' +
      'dates, or evidence that are not in the original text.',
    DECISION_RULE,
    AUTHORITY_RULE,
    NO_ATTRIBUTION_RULE,
    RESPONSE_FORMAT_RULE,
  ].join(' ');

  return { instruction, text };
}
