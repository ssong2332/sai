/**
 * C4 역번역 프롬프트 — 텍스트와 `PROMPT_VERSION`을 같은 곳에 둔다
 * (`docs/Architecture.md` Folder Structure "prompts/ # 프롬프트 텍스트 + PROMPT_VERSION 상수").
 *
 * 🔴 `PROMPT_VERSION`은 캐시 키(`llm_cache.cache_key` = sha256(model ∥ promptVersion ∥ step ∥
 * canonicalJSON(payload)))에 들어간다 — 이 프롬프트(아래 `instruction` 문자열)를 고치면
 * 반드시 이 값을 올린다. 올리지 않으면 옛 캐시 응답이 새 프롬프트인 것처럼 반환된다
 * (`docs/Architecture.md` Conventions 10).
 *
 * `apps/web/lib/llm/openai.ts`는 시스템 메시지를 따로 만들지 않고 payload 전체를 단일 user
 * 메시지의 JSON 본문으로 보낸다(그 파일 헤더 주석 "범위 경계" 참조) — 그래서 지시문
 * (`instruction`)을 payload 안에 담는다.
 */
import type { LanguageCode } from '../contract';

/** 🔴 프롬프트 문구를 바꾸면 이 값을 올린다. */
export const C4_PROMPT_VERSION = 'c4-v1';

export interface C4Payload {
  instruction: string;
  text: string;
  targetLanguage: LanguageCode;
}

function languageLabel(language: LanguageCode): string {
  return language === 'ko' ? 'Korean' : 'English';
}

/**
 * C4 역번역 요청 payload를 만든다.
 *
 * @param text 역번역할 텍스트(정상 입력은 C2 변환 결과 — `steps/c4.ts` JSDoc 참조).
 * @param targetLanguage 역번역 결과가 나와야 할 언어(발신자의 원문 언어).
 */
export function buildC4Payload(text: string, targetLanguage: LanguageCode): C4Payload {
  return {
    instruction:
      `Translate the text given in "text" into ${languageLabel(targetLanguage)}. ` +
      'This is a literal back-translation used only so the original author can check for meaning ' +
      'drift before sending — translate naturally but preserve tone, numbers, dates, and named ' +
      'entities exactly (do not soften or embellish). ' +
      'Respond with JSON only, matching exactly this shape: {"backTranslation": "<translated text>"}. ' +
      'Do not add any text outside the JSON object.',
    text,
    targetLanguage,
  };
}
