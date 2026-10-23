/**
 * LLM provider 추상화.
 *
 * 🔴 `docs/Spec.md` §6-3은 **OpenAI 확정**이다 — 배포·제출 경로의 기준 provider는 계속 OpenAI다.
 *    Gemini는 **로컬 개발/테스트용 대체 provider**로 추가한 것이며(사용자 결정, 2026-08-12),
 *    Spec을 뒤집은 것이 아니다. 두 경로 모두 같은 payload를 받아 같은 JSON 계약을 돌려준다.
 *
 * 🔴 어떤 provider도 메시지 본문을 로그·에러 메시지에 담지 않는다 (Spec 필수 5 Zero Retention).
 */

import { FALLBACK_REASONS } from '../fallback.js';
import { callOpenAI, DEFAULT_OPENAI_MODEL } from './openai.js';
import { callGemini, DEFAULT_GEMINI_MODEL } from './gemini.js';
import { callAnthropic, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js';
import { callGroq, DEFAULT_GROQ_MODEL } from './groq.js';

/** 호출 실패를 폴백 사유로 분류해 실어 나른다 — 메시지 본문은 담지 않는다. */
export class RefineCallError extends Error {
  constructor(reason, detail) {
    super(`refine call failed: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'RefineCallError';
    this.reason = reason;
  }
}

export const PROVIDERS = {
  openai: { call: callOpenAI, defaultModel: DEFAULT_OPENAI_MODEL, envKey: 'OPENAI_API_KEY' },
  gemini: { call: callGemini, defaultModel: DEFAULT_GEMINI_MODEL, envKey: 'GEMINI_API_KEY' },
  // 🔴 2026-10-23 — 기본 provider(폴오버 사슬 1번, `failover.js`). gemini는 사슬 밖 — 명시할 때만 쓴다.
  anthropic: { call: callAnthropic, defaultModel: DEFAULT_ANTHROPIC_MODEL, envKey: 'ANTHROPIC_API_KEY' },
  // 🔴 2026-10-23 — 폴오버 사슬 2번. OpenAI 호환 엔드포인트 재사용(openai는 사슬 밖 — 키 무효 2026-09-28~).
  groq: { call: callGroq, defaultModel: DEFAULT_GROQ_MODEL, envKey: 'GROQ_API_KEY' },
};

/** Spec 기준 provider. 명시하지 않으면 이 값이 쓰인다. */
export const SPEC_PROVIDER = 'openai';

export function resolveProvider(name = SPEC_PROVIDER) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new RefineCallError(
      FALLBACK_REASONS.ERROR,
      `unknown provider (expected one of ${Object.keys(PROVIDERS).join(', ')})`,
    );
  }
  return provider;
}

/**
 * HTTP 상태·오류 코드 → 폴백 사유 판정표. provider 공통.
 *
 * | 조건 | 사유 | 근거 |
 * |---|---|---|
 * | 429 · `insufficient_quota` · `rate_limit_exceeded` · `RESOURCE_EXHAUSTED` | quota | 2026-08-13·08-17 실측 |
 * | `billing_error` | quota | Anthropic SDK `ErrorType`(크레딧 소진) — 🔴 미실측 |
 * | 401 · `invalid_api_key` | auth | OpenAI 가짜 키 실측(2026-10-12 L15) |
 * | 상세 사유 `API_KEY_INVALID` | auth | Gemini 가짜 키 실측 — **400** `INVALID_ARGUMENT`로 온다(2026-10-12) |
 * | 403 | auth | 🔴 추정(미실측) — 키 정지·API 미사용 설정. 어느 쪽이든 키·콘솔을 손봐야 한다 |
 * | 그 밖 | error | 400 `INVALID_ARGUMENT`만으로는 auth가 아니다 — 요청 형식 문제일 수 있다 |
 *
 * @param {number} status
 * @param {string} [errorCode] provider의 오류 코드(OpenAI `code`·`type`, Gemini `status`).
 * @param {string} [detailReason] Gemini `error.details[].reason`.
 */
export function classifyHttpFailure(status, errorCode, detailReason) {
  if (
    status === 429 ||
    errorCode === 'insufficient_quota' ||
    errorCode === 'rate_limit_exceeded' ||
    errorCode === 'RESOURCE_EXHAUSTED' ||
    errorCode === 'billing_error' // Anthropic 크레딧 소진 — 한도와 같이 다음 단계로 넘긴다
  ) {
    return FALLBACK_REASONS.QUOTA;
  }
  if (
    status === 401 ||
    status === 403 ||
    errorCode === 'invalid_api_key' ||
    detailReason === 'API_KEY_INVALID'
  ) {
    return FALLBACK_REASONS.AUTH;
  }
  return FALLBACK_REASONS.ERROR;
}

/** 응답 본문 문자열에서 JSON을 꺼낸다. provider 공통. */
export function parseJsonContent(content) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new RefineCallError(FALLBACK_REASONS.INVALID, 'empty content');
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new RefineCallError(FALLBACK_REASONS.INVALID, 'content not json');
  }
}

export { DEFAULT_OPENAI_MODEL } from './openai.js';
export { DEFAULT_GEMINI_MODEL } from './gemini.js';
