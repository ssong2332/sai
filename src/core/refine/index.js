/**
 * `POST /v1/refine` 핸들러 코어 — Firebase에 의존하지 않는 순수 모듈이다.
 * S02 완료 후 `functions/`가 이 `refine()`을 얇게 감싸기만 하면 된다.
 *
 * Spec §6-3: OpenAI **1회 호출**로 `refined` / `backTranslation` / `detectedIntent` / `ticket` /
 * `appliedGlossary` / `urgency` 6필드를 반환한다. 순차 호출 금지.
 *
 * 🔴 Zero Retention (Spec 필수 5): 이 파일은 메시지 본문·교정문을 로그로 내보내지 않는다.
 *    `deps.logger`에 넘기는 것은 카운트·수치·플래그뿐이다.
 */

import { buildRefinePayload, REFINE_PROMPT_VERSION, URGENCY_LEVELS } from './prompt.js';
import { normalizeRefineResponse } from './schema.js';
import { computeCacheKey, MemoryCacheStore } from './cache.js';
import { buildFallbackResponse, FALLBACK_REASONS } from './fallback.js';
import {
  resolveProvider,
  classifyHttpFailure,
  parseJsonContent,
  RefineCallError,
  SPEC_PROVIDER,
} from './providers/index.js';

export { REFINE_PROMPT_VERSION, URGENCY_LEVELS } from './prompt.js';
export { FALLBACK_REASONS } from './fallback.js';
export { MemoryCacheStore, computeCacheKey } from './cache.js';
export { PROVIDERS, SPEC_PROVIDER, RefineCallError } from './providers/index.js';

/**
 * 🔴 **화면이 고를 수 있는 언어와 반드시 같아야 한다** (`src/lib/recipients.js`의
 *    `RECIPIENT_LANGUAGES`). 2026-08-16 실측에서 어긋난 적이 있다 — 수신자 언어에 「일본어」를
 *    넣었는데 여기가 ko/en/zh만 받아서, 그 수신자로 교정하면 **통째로 실패**했다.
 *    한쪽만 늘리면 화면에는 있는데 서버가 거절하는 조합이 생긴다.
 * 🔴 언어를 늘릴 때 함께 볼 곳: 여기 · `prompt.js`의 `LANGUAGE_LABELS` ·
 *    `conventions.js` · `lib/recipients.js`.
 */
const SUPPORTED_LANGUAGES = ['ko', 'en', 'zh', 'ja', 'de', 'fr', 'es'];

export class RefineRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RefineRequestError';
  }
}

/**
 * 요청을 검증하고 기본값을 채운다. 🔴 검증 실패 메시지에 본문을 담지 않는다.
 */
function normalizeRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new RefineRequestError('request must be an object');
  }
  const { text, sourceLanguage, targetLanguage } = request;

  if (typeof text !== 'string' || text.trim() === '') {
    throw new RefineRequestError('text is required');
  }
  if (!SUPPORTED_LANGUAGES.includes(sourceLanguage)) {
    throw new RefineRequestError(`sourceLanguage must be one of ${SUPPORTED_LANGUAGES.join(', ')}`);
  }
  if (!SUPPORTED_LANGUAGES.includes(targetLanguage)) {
    throw new RefineRequestError(`targetLanguage must be one of ${SUPPORTED_LANGUAGES.join(', ')}`);
  }

  const userUrgency = request.userUrgency ?? null;
  if (userUrgency !== null && !URGENCY_LEVELS.includes(userUrgency)) {
    throw new RefineRequestError(`userUrgency must be null or one of ${URGENCY_LEVELS.join(', ')}`);
  }

  return {
    text,
    sourceLanguage,
    targetLanguage,
    userUrgency,
    honorificLevel: request.honorificLevel ?? null,
    glossary: Array.isArray(request.glossary) ? request.glossary : [],
    // 🔴 이 세 필드를 여기서 통과시키지 않으면 프롬프트에도, 캐시 키에도 들어가지 않는다.
    //    실제로 그 사고가 났다(2026-08-13 실측): 클라이언트는 `casualTone`을 보내는데 화이트리스트가
    //    떨어뜨려, 캐주얼 ON/OFF가 **같은 캐시 키**가 되고 응답이 `cached:true`로 동일하게 나왔다.
    //    새 payload 필드를 추가할 때는 반드시 여기에도 추가한다.
    profile: request.profile ?? null,          // S13 / Spec 필수 2
    recipient: request.recipient ?? null,      // S17 / Spec 필수 9
    casualTone: request.casualTone ?? null,    // S16 / Spec 필수 8
    /**
     * S21 / Spec 권장 8 — 직전 대화 최대 5개.
     * 🔴 서버에서도 상한을 다시 강제한다. 클라이언트만 믿으면 상한이 없는 것과 같다(호출 비용·
     *    지연이 그대로 늘고, 프롬프트가 맥락에 잠식된다).
     * 🔴 이 값은 **어떤 로그·저장소에도 들어가지 않는다** — 아래 logger 호출은 건수만 싣는다.
     */
    threadContext: normalizeThreadContext(request.threadContext),
    referenceDate: request.referenceDate ?? new Date().toISOString().slice(0, 10),
    bypassCache: request.bypassCache === true,
  };
}

/** Spec 권장 8 — 최대 5개 / 2,000자. 클라이언트 상한과 같은 값을 서버에서 다시 적용한다. */
const MAX_THREAD_MESSAGES = 5;
const MAX_THREAD_CHARS = 2000;

/**
 * 🔴 형태가 다른 입력(문자열 배열, 잡객체)이 와도 조용히 통과시키지 않는다 — 통과시키면
 *    프롬프트에 형태 불명 데이터가 실려 모델이 그걸 지시문으로 읽을 여지가 생긴다.
 *    받아들이는 형태는 `{text: string}`뿐이고, 나머지 키는 버린다.
 */
function normalizeThreadContext(value) {
  if (!Array.isArray(value)) return [];
  const kept = [];
  let total = 0;
  // 상한 초과 시 버릴 것은 먼 과거다 — 뒤(최신)에서부터 채운다.
  for (let i = value.length - 1; i >= 0 && kept.length < MAX_THREAD_MESSAGES; i -= 1) {
    const text = typeof value[i]?.text === 'string' ? value[i].text.trim() : '';
    if (text === '') continue;
    if (total + text.length > MAX_THREAD_CHARS) break;
    total += text.length;
    kept.unshift({ text });
  }
  return kept;
}

/**
 * 교정 요청을 처리한다. **던지지 않는다** — LLM 실패는 폴백 응답으로 흡수한다
 * (요청 자체가 잘못된 경우만 RefineRequestError를 던진다).
 *
 * @param {object} request
 * @param {string} request.text 원문.
 * @param {'ko'|'en'|'zh'} request.sourceLanguage
 * @param {'ko'|'en'|'zh'} request.targetLanguage
 * @param {'CRITICAL'|'NORMAL'|'LOW'|null} [request.userUrgency] 사전 선택 긴급도 (Spec 필수 1).
 * @param {'hapsyo'|'haeyo'|null} [request.honorificLevel]
 * @param {Array} [request.glossary] 용어집 엔트리 (Spec 필수 7).
 * @param {string} [request.referenceDate] `YYYY-MM-DD`. 생략 시 오늘.
 * @param {boolean} [request.bypassCache] true면 캐시를 무시하고 재호출 (Lessons #6).
 *
 * @param {object} deps
 * @param {string} deps.apiKey provider API 키.
 * @param {'openai'|'gemini'} [deps.provider] 생략 시 Spec 기준 provider(openai).
 * @param {string} [deps.model] 생략 시 provider 기본 모델.
 * @param {object} [deps.cache] get/set을 가진 스토어. 생략 시 프로세스 메모리 캐시.
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {number} [deps.timeoutMs]
 * @param {(event: object) => void} [deps.logger] 🔴 본문 없는 메타데이터만 받는다.
 * @param {() => number} [deps.now]
 */
export async function refine(request, deps = {}) {
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

  const payload = buildRefinePayload(input);
  // 🔴 provider도 캐시 키에 들어간다 — 같은 모델명을 쓰는 다른 provider의 응답이 섞이면
  //    회귀 비교가 조용히 망가진다.
  const cacheKey = computeCacheKey({
    model: `${providerName}:${model}`,
    promptVersion: REFINE_PROMPT_VERSION,
    payload,
  });
  const startedAt = now();

  // ── 캐시 (Lessons #6) — bypassCache면 조회를 건너뛰되, 새 결과는 갱신해 둔다.
  if (!input.bypassCache) {
    const hit = cache.get(cacheKey);
    if (hit !== undefined) {
      logger({ event: 'refine', cacheHit: true, fallback: hit.fallback, urgency: hit.urgency, latencyMs: now() - startedAt });
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
    const reason = error instanceof RefineCallError ? error.reason : FALLBACK_REASONS.ERROR;
    const fallbackResult = buildFallbackResponse(input, reason);
    // 🔴 진단용 상세(HTTP 상태·분류 코드). 메시지 본문은 담기지 않는다(providers/*가 보장).
    fallbackResult.fallbackDetail = error?.message ?? String(error);
    // 🔴 폴백은 캐시하지 않는다 — 키가 복구된 뒤에도 폴백이 계속 반환되면 시연이 망가진다.
    logger({ event: 'refine', cacheHit: false, fallback: true, fallbackReason: reason, urgency: fallbackResult.urgency, latencyMs: now() - startedAt });
    return fallbackResult;
  }

  const { result, issues } = normalizeRefineResponse(raw, { userUrgency: input.userUrgency });

  if (result === null) {
    const fallbackResult = buildFallbackResponse(input, FALLBACK_REASONS.INVALID);
    logger({ event: 'refine', cacheHit: false, fallback: true, fallbackReason: FALLBACK_REASONS.INVALID, issues, latencyMs: now() - startedAt });
    return fallbackResult;
  }

  /**
   * S21 — 화면의 "직전 대화 N개 참고함"이 쓰는 값 (Spec 권장 8).
   * 🔴 클라이언트가 보낸 개수가 아니라 **실제로 프롬프트에 실린 개수**를 돌려준다 — 서버가
   *    상한으로 잘라냈는데 화면이 보낸 개수를 말하면 그건 거짓 표시다.
   * 🔴 개수뿐이다. 맥락 본문은 응답에도 싣지 않는다.
   */
  result.threadContextCount = input.threadContext.length;

  cache.set(cacheKey, result);
  logger({
    event: 'refine',
    provider: providerName,
    cacheHit: false,
    fallback: false,
    urgency: result.urgency,
    urgencySource: result.urgencySource,
    detectedIntent: result.detectedIntent,
    // 🔴 수치·건수만 — 적용된 용어의 원문은 싣지 않는다 (Spec 필수 5).
    appliedGlossaryCount: result.appliedGlossary.length,
    misreadRiskCount: result.misreadRisks.length,
    // 🔴 S21 — **건수만**. 맥락은 남이 쓴 메시지 본문이라 한 조각도 로그에 남기지 않는다.
    threadContextCount: input.threadContext.length,
    issues,
    latencyMs: now() - startedAt,
  });

  return { ...result, cached: false };
}

/** 모듈 수준 기본 캐시 — 프로세스 메모리 전용(cache.js의 Zero Retention 경계 주석 참조). */
const defaultCache = new MemoryCacheStore();
