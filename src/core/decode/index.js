/**
 * `POST /v1/refine` (mode: "decode") 핸들러 코어 — Firebase에 의존하지 않는 순수 모듈.
 *
 * 🔴 refine과 **같은 provider·cache 인프라를 공유**한다(`../refine/providers`, `../refine/cache`).
 *    프롬프트·계약만 다르다 — 인프라를 두 벌로 만들면 그중 하나만 고치는 사고가 난다.
 * 🔴 Zero Retention (Spec 필수 5): `deps.logger`에는 카운트·수치·플래그만 넘긴다.
 */

import { buildDecodePayload, DECODE_PROMPT_VERSION } from './prompt.js';
import { normalizeDecodeResponse } from './schema.js';
import { computeCacheKey, MemoryCacheStore } from '../refine/cache.js';

export { MemoryCacheStore, computeCacheKey } from '../refine/cache.js';
import { buildDecodeFallbackResponse, DECODE_FALLBACK_REASONS } from './fallback.js';
import {
  resolveProvider,
  classifyHttpFailure,
  parseJsonContent,
  RefineCallError,
  SPEC_PROVIDER,
} from '../refine/providers/index.js';

export { DECODE_PROMPT_VERSION } from './prompt.js';
export { DECODE_FALLBACK_REASONS } from './fallback.js';

/**
 * 🔴 **`refine`과 같은 7개 집합이어야 한다** (2026-08-20 실측으로 잡은 불일치).
 *
 *    교정(refine)은 7개(ko·en·zh·ja·de·fr·es)를 받는데 해독은 3개만 받고 있었다.
 *    **일본어·독일어·프랑스어·스페인어로 온 메시지는 뜻 풀기가 서버에서 400으로 거절**됐다
 *    (실측: `sourceLanguage must be one of ko, en, zh`). 교정은 되는데 그 상대가 보낸 답장은
 *    못 푸는 상태였고, 이 제품이 전제하는 상황이 정확히 그 왕복이다.
 * 🔴 `decode/prompt.js`의 `LANGUAGE_LABELS`도 **같이** 늘려야 한다 — 라벨이 없으면 모델에게
 *    코드(`ja`)를 그대로 건네게 되어 지시문이 흐려진다.
 */
const SUPPORTED_LANGUAGES = ['ko', 'en', 'zh', 'ja', 'de', 'fr', 'es'];

/** 프롬프트가 "up to five"라고 말한다 — 두 값이 어긋나면 지시문이 거짓말이 된다. */
const MAX_THREAD_CONTEXT = 5;

export class DecodeRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecodeRequestError';
  }
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new DecodeRequestError('request must be an object');
  }
  const { text, sourceLanguage, targetLanguage } = request;

  if (typeof text !== 'string' || text.trim() === '') {
    throw new DecodeRequestError('text is required');
  }
  if (!SUPPORTED_LANGUAGES.includes(sourceLanguage)) {
    throw new DecodeRequestError(`sourceLanguage must be one of ${SUPPORTED_LANGUAGES.join(', ')}`);
  }
  if (!SUPPORTED_LANGUAGES.includes(targetLanguage)) {
    throw new DecodeRequestError(`targetLanguage must be one of ${SUPPORTED_LANGUAGES.join(', ')}`);
  }

  return {
    text,
    sourceLanguage,
    targetLanguage,
    threadContext: normalizeThreadContext(request.threadContext),
    bypassCache: request.bypassCache === true,
  };
}

/**
 * 직전 대화 맥락을 정규화한다 (v2). **던지지 않는다** — 맥락은 선택 사항이라 형태가 이상하면
 * 조용히 버리고 맥락 없는 해독으로 돌아간다.
 * 🔴 5개 상한은 refine 쪽 계약과 같다(프롬프트가 "up to five"라고 말한다).
 */
function normalizeThreadContext(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .slice(-MAX_THREAD_CONTEXT);
}

/**
 * 해독 요청을 처리한다. **던지지 않는다** — LLM 실패는 폴백 응답으로 흡수한다.
 *
 * @param {object} request
 * @param {string} request.text 상대가 보낸 원문.
 * @param {'ko'|'en'|'zh'} request.sourceLanguage
 * @param {'ko'|'en'|'zh'} request.targetLanguage 해석을 보여줄 언어.
 * @param {boolean} [request.bypassCache]
 *
 * @param {object} deps
 * @param {string} deps.apiKey
 * @param {string} [deps.provider]
 * @param {string} [deps.model]
 * @param {object} [deps.cache]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {number} [deps.timeoutMs]
 * @param {(event: object) => void} [deps.logger]
 * @param {() => number} [deps.now]
 */
export async function decode(request, deps = {}) {
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

  const payload = buildDecodePayload(input);
  const cacheKey = computeCacheKey({
    model: `${providerName}:${model}`,
    promptVersion: DECODE_PROMPT_VERSION,
    payload,
  });
  const startedAt = now();

  if (!input.bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit !== undefined) {
      logger({ event: 'decode', cacheHit: true, fallback: hit.fallback, surfaceUrgency: hit.surfaceUrgency, latencyMs: now() - startedAt });
      return { ...hit, cached: true };
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
    const reason = error instanceof RefineCallError ? error.reason : DECODE_FALLBACK_REASONS.ERROR;
    const fallbackResult = buildDecodeFallbackResponse(input, reason);
    logger({ event: 'decode', cacheHit: false, fallback: true, fallbackReason: reason, latencyMs: now() - startedAt });
    return fallbackResult;
  }

  // 🔴 원문만 넘긴다(맥락 아님) — 긴급도 격차의 근거는 원문 안에서 읽혀야 한다(v3 관문).
  const { result, issues } = normalizeDecodeResponse(raw, input.text);

  if (result === null) {
    const fallbackResult = buildDecodeFallbackResponse(input, DECODE_FALLBACK_REASONS.INVALID);
    logger({ event: 'decode', cacheHit: false, fallback: true, fallbackReason: DECODE_FALLBACK_REASONS.INVALID, issues, latencyMs: now() - startedAt });
    return fallbackResult;
  }

  cache.set(cacheKey, result);
  logger({
    event: 'decode',
    cacheHit: false,
    fallback: false,
    surfaceUrgency: result.surfaceUrgency,
    actualUrgency: result.actualUrgency,
    urgencyGap: result.urgencyGap,
    requiredActionCount: result.requiredActions.length,
    // 🔴 맥락 **건수**와 추천 **키**만 — 본문은 한 글자도 싣지 않는다(Zero Retention).
    threadContextCount: input.threadContext.length,
    recommendedReply: result.recommendedReply,
    issues,
    latencyMs: now() - startedAt,
  });

  return { ...result, cached: false };
}

const defaultCache = new MemoryCacheStore();
