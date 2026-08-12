/**
 * C1 긴급도 분류 프롬프트 — 텍스트와 `PROMPT_VERSION`을 같은 곳에 둔다
 * (`docs/Architecture.md` Folder Structure "prompts/ # 프롬프트 텍스트 + PROMPT_VERSION 상수").
 * `packages/core/src/prompts/c4.ts`와 같은 패턴이다.
 *
 * 🔴 `PROMPT_VERSION`은 캐시 키(`llm_cache.cache_key`)에 들어간다 — 이 프롬프트(아래
 * `instruction` 문자열)를 고치면 반드시 이 값을 올린다(`docs/Architecture.md` Conventions 10).
 *
 * `apps/web/lib/llm/openai.ts`는 시스템 메시지를 따로 만들지 않고 payload 전체를 단일 user
 * 메시지의 JSON 본문으로 보낸다 — 그래서 지시문(`instruction`)을 payload 안에 담는다(`prompts/c4.ts`
 * 헤더 주석 참조).
 */

/** 🔴 프롬프트 문구를 바꾸면 이 값을 올린다. */
export const C1_PROMPT_VERSION = 'c1-v1';

export interface C1Payload {
  instruction: string;
  text: string;
}

/**
 * C1 긴급도 분류 요청 payload를 만든다.
 *
 * @param text 긴급도를 판정할 원문.
 */
export function buildC1Payload(text: string): C1Payload {
  return {
    instruction:
      'Classify the urgency of the message given in "text" as exactly one of "CRITICAL", ' +
      '"NORMAL", or "LOW". "CRITICAL" means immediate action is required and any delay would ' +
      'cause serious harm (e.g. production outage, safety issue, a deadline within hours). ' +
      '"NORMAL" means an ordinary work request with a routine deadline. "LOW" means there is no ' +
      'meaningful time pressure (FYI, non-urgent question). ' +
      'Respond with JSON only, matching exactly this shape: ' +
      '{"urgency": "CRITICAL" | "NORMAL" | "LOW", "reason": "<one sentence in the same language ' +
      'as the input, explaining why this level was chosen>"}. ' +
      'Do not add any text outside the JSON object.',
    text,
  };
}
