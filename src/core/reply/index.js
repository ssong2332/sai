/**
 * `POST /v1/refine` (mode: "reply") 핸들러 코어 — Firebase에 의존하지 않는 순수 모듈.
 *
 * 🔴 refine·decode와 **같은 provider·cache 인프라를 공유**한다(`../refine/providers`,
 *    `../refine/cache`). 프롬프트·계약만 다르다.
 * 🔴 Zero Retention (Spec 필수 5): `deps.logger`에는 카운트·수치·플래그만 넘긴다.
 *    초안 본문과 원문은 로그에 한 글자도 실리지 않는다.
 */

import { buildReplyPayload, REPLY_PROMPT_VERSION, REPLY_INTENTS } from './prompt.js';
import { normalizeReplyResponse } from './schema.js';
import { computeCacheKey, MemoryCacheStore } from '../refine/cache.js';
import { MAX_ANSWER_LENGTH } from './questions.js';
import { buildReplyFallbackResponse, REPLY_FALLBACK_REASONS } from './fallback.js';
import {
  resolveProvider,
  classifyHttpFailure,
  parseJsonContent,
  RefineCallError,
  SPEC_PROVIDER,
} from '../refine/providers/index.js';

export { MemoryCacheStore, computeCacheKey } from '../refine/cache.js';
export { REPLY_PROMPT_VERSION, REPLY_INTENTS, REPLY_INTENT_LABELS } from './prompt.js';
export { REPLY_FALLBACK_REASONS } from './fallback.js';

const SUPPORTED_LANGUAGES = ['ko', 'en', 'zh'];

/** 사전 질문은 의도당 2개다 — 여유를 두되 상한은 둔다. */
const MAX_ANSWERS = 6;

export class ReplyRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReplyRequestError';
  }
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new ReplyRequestError('request must be an object');
  }
  const { text, intent, sourceLanguage, targetLanguage } = request;

  if (typeof text !== 'string' || text.trim() === '') {
    throw new ReplyRequestError('text is required');
  }
  // 🔴 화이트리스트다. 모르는 의도를 임의 방향으로 처리하면 사용자가 고르지 않은 회신이 나온다.
  if (!REPLY_INTENTS.includes(intent)) {
    throw new ReplyRequestError(`intent must be one of ${REPLY_INTENTS.join(', ')}`);
  }
  if (!SUPPORTED_LANGUAGES.includes(sourceLanguage)) {
    throw new ReplyRequestError(`sourceLanguage must be one of ${SUPPORTED_LANGUAGES.join(', ')}`);
  }
  if (!SUPPORTED_LANGUAGES.includes(targetLanguage)) {
    throw new ReplyRequestError(`targetLanguage must be one of ${SUPPORTED_LANGUAGES.join(', ')}`);
  }

  return {
    text,
    intent,
    sourceLanguage,
    targetLanguage,
    answers: normalizeAnswers(request.answers),
    bypassCache: request.bypassCache === true,
  };
}

/**
 * 사전 질문 답변을 정규화한다. **던지지 않는다** — 답변은 선택 사항이라, 형태가 이상하면
 * 요청 전체를 거절하는 대신 조용히 버리고 자리표시자 경로로 돌아간다.
 *
 * 🔴 개수·길이 상한을 여기서 강제한다. 이 값은 프롬프트에 실리므로, 상한이 없으면 호출자가
 *    답변 필드로 프롬프트를 통째로 밀어 넣을 수 있다.
 */
function normalizeAnswers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, MAX_ANSWERS)) {
    if (!item || typeof item.question !== 'string' || typeof item.answer !== 'string') continue;
    const question = item.question.trim().slice(0, MAX_ANSWER_LENGTH);
    const answer = item.answer.trim().slice(0, MAX_ANSWER_LENGTH);
    if (question === '' || answer === '') continue;
    out.push({ question, answer });
  }
  return out;
}

/**
 * 회신 초안 요청을 처리한다. **던지지 않는다** — LLM 실패는 폴백 응답으로 흡수한다.
 * (요청 자체가 계약 위반이면 `ReplyRequestError`를 던진다 — 이건 호출자 버그다.)
 *
 * @param {object} request
 * @param {string} request.text 상대가 보낸 원문.
 * @param {'accept'|'schedule'|'clarify'} request.intent 사용자가 고른 회신 방향.
 * @param {'ko'|'en'|'zh'} request.sourceLanguage 원문 언어 = 회신을 쓸 언어.
 * @param {'ko'|'en'|'zh'} request.targetLanguage 역번역 언어.
 * @param {boolean} [request.bypassCache]
 * @param {object} deps decode와 동일.
 */
export async function reply(request, deps = {}) {
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

  const payload = buildReplyPayload(input);
  const cacheKey = computeCacheKey({
    model: `${providerName}:${model}`,
    promptVersion: REPLY_PROMPT_VERSION,
    payload,
  });
  const startedAt = now();

  if (!input.bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit !== undefined) {
      logger({ event: 'reply', intent: input.intent, cacheHit: true, fallback: hit.fallback, latencyMs: now() - startedAt });
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
    const reason = error instanceof RefineCallError ? error.reason : REPLY_FALLBACK_REASONS.ERROR;
    logger({ event: 'reply', intent: input.intent, cacheHit: false, fallback: true, fallbackReason: reason, latencyMs: now() - startedAt });
    return buildReplyFallbackResponse(input, reason);
  }

  const { result, issues } = normalizeReplyResponse(raw);

  if (result === null) {
    logger({ event: 'reply', intent: input.intent, cacheHit: false, fallback: true, fallbackReason: REPLY_FALLBACK_REASONS.INVALID, issues, latencyMs: now() - startedAt });
    return buildReplyFallbackResponse(input, REPLY_FALLBACK_REASONS.INVALID);
  }

  cache.set(cacheKey, result);
  logger({
    event: 'reply',
    intent: input.intent,
    cacheHit: false,
    fallback: false,
    // 🔴 길이·건수 수치만 — 본문도 답변 내용도 싣지 않는다(Zero Retention).
    draftLength: result.draft.length,
    answerCount: input.answers.length,
    issues,
    latencyMs: now() - startedAt,
  });

  return { ...result, cached: false };
}

const defaultCache = new MemoryCacheStore();
