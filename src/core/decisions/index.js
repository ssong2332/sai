/**
 * `POST /v1/refine` (mode: "decisions") 핸들러 코어 — Firebase에 의존하지 않는 순수 모듈.
 *
 * 🔴 refine·decode와 **같은 provider·cache 인프라를 공유**한다(`../refine/providers`,
 *    `../refine/cache`). 프롬프트·계약만 다르다 — 인프라를 세 벌로 만들면 그중 하나만 고치는
 *    사고가 난다.
 * 🔴 Zero Retention (Spec 필수 5): `deps.logger`에는 **카운트·플래그만** 넘긴다. 결정 문구·담당자
 *    이름은 남이 쓴 메시지에서 뽑은 것이라 한 조각도 로그에 남기지 않는다.
 */

import { buildDecisionsPayload, DECISIONS_PROMPT_VERSION } from './prompt.js';
import { normalizeDecisionsResponse } from './schema.js';
import { buildDecisionsFallbackResponse, DECISIONS_FALLBACK_REASONS } from './fallback.js';
import { computeCacheKey, MemoryCacheStore } from '../refine/cache.js';
import {
  resolveProvider,
  classifyHttpFailure,
  parseJsonContent,
  RefineCallError,
  SPEC_PROVIDER,
} from '../refine/providers/index.js';

export { MemoryCacheStore, computeCacheKey } from '../refine/cache.js';
export { DECISIONS_PROMPT_VERSION, AUTHORITY_STATUSES, AUTHORITY_UNKNOWN } from './prompt.js';
export { DECISIONS_FALLBACK_REASONS } from './fallback.js';
export { normalizeDecisionsResponse, deriveCounts } from './schema.js';

/**
 * 🔴 스레드 전체가 들어오므로 refine의 본문보다 길다. 상한을 두지 않으면 토큰 비용이 입력 길이에
 *    비례해 터진다. 24000자는 A4 기준 ~12장 — 실무 스레드로 충분하고, 넘으면 **앞을 자른다**
 *    (최근 대화가 결정에 가깝다).
 */
export const MAX_THREAD_CHARS = 24000;

export class DecisionsRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecisionsRequestError';
  }
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new DecisionsRequestError('request must be an object');
  }
  const { text } = request;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new DecisionsRequestError('text is required');
  }

  const trimmed = text.trim();
  // 🔴 뒤가 아니라 **앞**을 자른다 — 결정은 대화 끝에서 내려진다.
  const capped =
    trimmed.length > MAX_THREAD_CHARS ? trimmed.slice(trimmed.length - MAX_THREAD_CHARS) : trimmed;

  return {
    text: capped,
    truncated: capped.length < trimmed.length,
    bypassCache: request.bypassCache === true,
  };
}

const defaultCache = new MemoryCacheStore();

/**
 * 결정 요약 요청을 처리한다. **던지지 않는다** — LLM 실패는 폴백 응답으로 흡수한다.
 *
 * @param {object} request
 * @param {string} request.text 요약할 대화 스레드 원문.
 * @param {boolean} [request.bypassCache]
 * @param {object} deps `decode()`와 동일한 형태.
 */
export async function summarizeDecisions(request, deps = {}) {
  const input = normalizeRequest(request);
  const {
    apiKey,
    provider: providerName = SPEC_PROVIDER,
    cache = defaultCache,
    fetchImpl,
    timeoutMs,
    logger = () => {},
    now = () => Date.now(),
  } = deps;

  const provider = resolveProvider(providerName);
  const model = deps.model ?? provider.defaultModel;

  const payload = buildDecisionsPayload(input);
  const cacheKey = computeCacheKey({
    model: `${providerName}:${model}`,
    promptVersion: DECISIONS_PROMPT_VERSION,
    payload,
  });
  const startedAt = now();

  if (!input.bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit !== undefined) {
      logger({
        event: 'decisions',
        cacheHit: true,
        fallback: hit.fallback === true,
        decisionCount: hit.decisionCount,
        latencyMs: now() - startedAt,
      });
      return { ...hit, truncated: input.truncated, cached: true };
    }
  }

  let raw;
  try {
    raw = await provider.call(payload, {
      apiKey,
      model,
      timeoutMs,
      fetchImpl,
      errors: { RefineCallError, classifyHttpFailure, parseJsonContent },
    });
  } catch (error) {
    const reason =
      error instanceof RefineCallError ? error.reason : DECISIONS_FALLBACK_REASONS.ERROR;
    logger({
      event: 'decisions',
      cacheHit: false,
      fallback: true,
      fallbackReason: reason,
      latencyMs: now() - startedAt,
    });
    return { ...buildDecisionsFallbackResponse(input, reason), truncated: input.truncated };
  }

  const { result, issues } = normalizeDecisionsResponse(raw);

  if (result === null) {
    logger({
      event: 'decisions',
      cacheHit: false,
      fallback: true,
      fallbackReason: DECISIONS_FALLBACK_REASONS.INVALID,
      issues,
      latencyMs: now() - startedAt,
    });
    return {
      ...buildDecisionsFallbackResponse(input, DECISIONS_FALLBACK_REASONS.INVALID),
      truncated: input.truncated,
    };
  }

  const payloadOut = { ...result, fallback: false, fallbackReason: null, fallbackNotice: null };
  cache.set(cacheKey, payloadOut);
  logger({
    event: 'decisions',
    cacheHit: false,
    fallback: false,
    // 🔴 수치만 — 결정 문구·담당자 이름은 싣지 않는다 (Spec 필수 5).
    decisionCount: result.decisionCount,
    unresolvedCount: result.unresolvedCount,
    unknownAuthorityCount: result.unknownAuthorityCount,
    issues,
    latencyMs: now() - startedAt,
  });

  return { ...payloadOut, truncated: input.truncated, cached: false };
}
