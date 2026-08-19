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

/** HTTP 상태·오류 코드 → 폴백 사유 판정표. provider 공통. */
export function classifyHttpFailure(status, errorCode) {
  if (
    status === 429 ||
    errorCode === 'insufficient_quota' ||
    errorCode === 'rate_limit_exceeded' ||
    errorCode === 'RESOURCE_EXHAUSTED'
  ) {
    return FALLBACK_REASONS.QUOTA;
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
