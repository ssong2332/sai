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
import { isRefinedInTargetScript, isRefinedComplete, isCurrencyConsistent, isFormalAddress, checkBackTranslation } from './backcheck.js';
import { checkNumbersPreserved } from './numberCheck.js';
import {
  countMissingGlossary,
  glossaryHitCount,
  missingGlossaryEntries,
  reconcileAppliedGlossary,
  withGlossaryReminder,
} from './glossaryVerify.js';
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
    // 🔴 문체 수위(가볍게·기본·격식). 2026-11-01 실브라우저에서 발견 — 이 줄이 없어 확장이 보낸 값이 버려지고
    //    프롬프트가 늘 「DEFAULT REGISTER」였다(가볍게·격식 토글 무효). 모르는 값은 기본(null).
    register: request.register === 'casual' || request.register === 'formal' ? request.register : null,
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
 * 일시 장애 재호출 판정 — `error` 사유 중 **5xx(529 과부하 포함)·연결 실패**만.
 * | 분류 문자열(providers/*가 만든다 — 본문 없음) | 다시 부르나 |
 * |---|---|
 * | `(http 5xx)` | 예 |
 * | `(http 4xx)`(400 잘못된 요청 등 — 다시 불러도 같다) | 아니오 |
 * | 타임아웃·abort·키 없음 | 아니오 |
 * | 그 밖(연결 실패 — `APIConnectionError`·`fetch failed` 등) | 예 |
 */
function isRetryableTransient(error) {
  const detail = String(error?.message ?? error ?? '');
  const http = /\(http (\d{3})\)/.exec(detail);
  if (http) return http[1].startsWith('5');
  return !/timeout|timed out|abort|missing api key/i.test(detail);
}

/**
 * 교정문 내용 검사 — 걸린 사유 코드 하나, 없으면 null. 판정표는 `backcheck.js`의 각 함수에 있다.
 * | 순서 | 검사 | 사유 코드 |
 * |---|---|---|
 * | 1 | 교정문이 상대 언어로 왔는가(통째로 한국어 등) — `isRefinedInTargetScript` | `refined-wrong-script` |
 * | 2 | 말줄임표로 끊기거나 머뭇거리지 않았는가 — `isRefinedComplete` | `refined-truncated` |
 * | 3 | 원문에 없던 통화(위안·엔)가 나오지 않았는가 — `isCurrencyConsistent` | `refined-currency` |
 * | 4 | 독일어·스페인어가 존칭 2인칭(Sie·usted)인가 — `isFormalAddress` | `refined-informal` |
 */
function findContentIssue(result, input) {
  if (!isRefinedInTargetScript(result.refined, input.sourceLanguage, input.targetLanguage)) return 'refined-wrong-script';
  if (!isRefinedComplete(result.refined, input.text)) return 'refined-truncated';
  if (!isCurrencyConsistent(result.refined, input.text)) return 'refined-currency';
  if (!isFormalAddress(result.refined, input.targetLanguage, input.text)) return 'refined-informal';
  return null;
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
 * @param {string} [deps.thinking] anthropic 사고 스위치(`providers/anthropic.js` 판정표). 생략하면 provider가
 *   `process.env.SAI_ANTHROPIC_THINKING`을 읽는다(Node 경로). Worker는 항상 넘긴다 — `process`를 건드리지 않게.
 * @param {string} [deps.effort] anthropic effort(`providers/anthropic.js` 판정표). 생략하면 `low`.
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
    thinking,
    effort,
    logger = () => {},
    now = () => Date.now(),
  } = deps;

  const provider = resolveProvider(providerName);
  const model = deps.model ?? provider.defaultModel;

  const payload = buildRefinePayload(input);
  // 🔴 provider도 캐시 키에 들어간다 — 같은 모델명을 쓰는 다른 provider의 응답이 섞이면
  //    회귀 비교가 조용히 망가진다.
  // 🔴 2026-10-30 품질 모드 — 사고·effort도 키에 넣는다. 빠른 모드 결과가 심층 모드 요청에 캐시로 돌아가면 안 된다.
  const cacheKey = computeCacheKey({
    model: `${providerName}:${model}:${thinking ?? 'env'}:${effort ?? 'low'}`,
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

  /**
   * 🔴 내용 검사(언어·잘림·통화)에 걸리면 **한 번 더** 부른다 (2026-11-01 통합 실측).
   *    ko → zh 빠른 모드에서 같은 문장이 약 30% 걸렸다 — 확장의 `invalid` 재시도 한 번만으로는 두 번 연속 걸려
   *    「교정하지 못했어요」가 약 9%(추정)였다. 형식 위반(`result === null`)·호출 실패는 여기서 다시 부르지 않는다.
   * 🔴 이 재호출은 월 예산 추정(`qualityAllowance.js` — 요청당 고정 비용)에 잡히지 않는다. 마지막 방어선은 콘솔 한도다.
   * 🔴 일시 장애(`error` — 연결 실패·5xx)도 **한 번만** 다시 부른다. 실측 2026-11-01: 약 300회 중 3회 `error`, 같은 문장
   *    재실행은 정상 — 원인(HTTP 상태)은 확인하지 못했다. 타임아웃은 다시 부르지 않는다(기다림이 두 배가 된다).
   *    한도·키(`quota`·`auth`)는 여기가 아니라 서버 폴오버(`failover.js`)가 맡는다.
   */
  const MAX_CONTENT_ATTEMPTS = 2;
  /**
   * 🔴 확장은 30초에 끊는다(`config.js` `REFINE_TIMEOUT_MS`). 다시 부르는 것은 **12초 안에 끝난 첫 시도**뿐이고,
   *    다시 부를 때는 15초에 끊는다 — 합쳐도 27초. 그보다 늦으면 다시 부르지 않고 그대로 폴백한다.
   */
  const RETRY_ELAPSED_LIMIT_MS = 12_000;
  const RETRY_TIMEOUT_MS = 15_000;
  const canRetry = () => now() - startedAt <= RETRY_ELAPSED_LIMIT_MS;
  let contentAttempts = 0;
  let transientRetried = false;
  /**
   * 🔴 **약한 검사** — 교정문은 쓸 만한데 흠이 있는 결과. 한 번 더 불러 보고, 두 번째가 더 낫지 않으면 **첫 결과를 준다**
   *    (폴백하지 않는다 — 화면이 이미 그 흠을 경고한다). 내용 검사(`findContentIssue`)와 달리 오탐이 있을 수 있어서다.
   * | 사유 | 판정 | 화면 경고 |
   * |---|---|---|
   * | `back` | 역번역이 교정문 복사·다른 언어(`checkBackTranslation`) — 통합 76건 중 1~3건 | 역번역 실패 안내 |
   * | `numbers` | 원문 숫자가 교정문에 없음(`checkNumbersPreserved`) — 실측: 「1,250만 원」→「1.250.000 KRW」(10배 작음) | 숫자 확인 필요 |
   * | `glossary` | 원문에 나온 용어의 등록된 말이 교정문에 없음(`glossaryVerify.js`) — 실측 2026-11-02: 팀 「배포 → ABC」 6회 중 2회 | 용어 반영 안 됨 |
   * 여럿이면 `numbers` > `glossary` > `back` 순이다(돈·날짜가 틀린 쪽이 가장 위험하다). 두 번째 결과를 쓰는 조건:
   * 약한 흠이 없거나, 두 번째의 흠이 첫 번째보다 뒤 순위일 때(예: 첫 결과는 숫자가 빠졌고 두 번째는 역번역만 깨졌다).
   */
  const SOFT_RANK = { numbers: 0, glossary: 1, back: 2 };
  const softIssueOf = (candidate) => {
    const dropped = checkNumbersPreserved(
      { refined: candidate.refined, sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage },
      input.text,
    );
    if (dropped.length > 0) return 'numbers';
    if (countMissingGlossary(candidate.refined, input.glossary, input.text) > 0) return 'glossary';
    const backUsable = checkBackTranslation({
      backTranslation: candidate.backTranslation,
      refined: candidate.refined,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
    }).usable;
    return backUsable ? null : 'back';
  };
  let softResult = null;
  const keepSoftResult = () => {
    ({ result, issues } = softResult);
    issues = [...issues, `${softResult.kind}-retry-failed`];
  };
  let result;
  let issues;
  // 🔴 재호출 때만 바뀔 수 있다(빠진 용어 알림 — `withGlossaryReminder`). 캐시 키는 원래 payload 그대로다.
  let callPayload = payload;
  // 🔴 용어 재호출 때만 바뀔 수 있다(`deps.glossaryRetry` — 빠른 모드면 기본 모드 모델, `quality.js`).
  let callModel = { model, thinking, effort };
  let contextCount = input.threadContext.length;
  for (let attempt = 1; ; attempt += 1) {
    let raw;
    // 🔴 2026-11-02 — 실제 호출마다 알린다(재호출 포함). Worker가 월 예산 추정에 더한다. 모델 이름·회차만 — 본문 없음.
    deps.onCall?.({ model: callModel.model ?? null, attempt });
    try {
      raw = await provider.call(callPayload, {
        apiKey,
        model: callModel.model,
        timeoutMs: attempt === 1 ? timeoutMs : Math.min(timeoutMs ?? RETRY_TIMEOUT_MS, RETRY_TIMEOUT_MS),
        fetchImpl,
        // 🔴 `undefined`는 그대로 넘긴다 — provider가 「안 넘김」으로 보고 process.env를 읽는다(Node 경로 불변).
        thinking: callModel.thinking,
        effort: callModel.effort,
        errors: { RefineCallError, classifyHttpFailure, parseJsonContent },
      });
    } catch (error) {
      const reason = error instanceof RefineCallError ? error.reason : FALLBACK_REASONS.ERROR;
      if (reason === FALLBACK_REASONS.ERROR && !transientRetried && isRetryableTransient(error) && canRetry()) {
        transientRetried = true;
        continue;
      }
      if (softResult) {
        keepSoftResult();
        break;
      }
      const fallbackResult = buildFallbackResponse(input, reason);
      // 🔴 진단용 상세(HTTP 상태·분류 코드). 메시지 본문은 담기지 않는다(providers/*가 보장).
      fallbackResult.fallbackDetail = error?.message ?? String(error);
      // 🔴 폴백은 캐시하지 않는다 — 키가 복구된 뒤에도 폴백이 계속 반환되면 시연이 망가진다.
      logger({ event: 'refine', cacheHit: false, fallback: true, fallbackReason: reason, urgency: fallbackResult.urgency, attempt, latencyMs: now() - startedAt });
      return fallbackResult;
    }

    ({ result, issues } = normalizeRefineResponse(raw, { userUrgency: input.userUrgency }));

    if (result === null && softResult) {
      keepSoftResult();
      break;
    }
    if (result === null) {
      const fallbackResult = buildFallbackResponse(input, FALLBACK_REASONS.INVALID);
      logger({ event: 'refine', cacheHit: false, fallback: true, fallbackReason: FALLBACK_REASONS.INVALID, issues, attempt, latencyMs: now() - startedAt });
      return fallbackResult;
    }

    const contentIssue = findContentIssue(result, input);
    if (contentIssue === null) {
      const softIssue = softIssueOf(result);
      if (softIssue && !softResult && canRetry()) {
        softResult = { result, issues: [...issues, `${softIssue}-broken`], kind: softIssue };
        if (softIssue === 'glossary') {
          /**
           * 🔴 용어 재호출은 **대화 참고 없이** 부른다 (2026-11-02 실측, 사용자 승인). 같은 문장 + 팀 「배포 → ABC」 +
           *    빠진 용어 알림: 대화 참고 없음 8/8 반영, 있음 1/5·0/8 — 「Hi」 한 줄만 있어도 실패했고 규칙 문장을 빼도 같았다
           *    (원인 미확인). 첫 호출은 대화 참고를 그대로 쓴다. 대가: 재호출 결과는 앞 대화를 가리키는 말을 못 풀 수 있다.
           */
          callPayload = withGlossaryReminder(
            buildRefinePayload({ ...input, threadContext: [] }),
            missingGlossaryEntries(result.refined, input.glossary, input.text),
          );
          if (deps.glossaryRetry?.model) callModel = { ...callModel, ...deps.glossaryRetry };
        }
        continue;
      }
      if (softResult) {
        const secondIsBetter =
          softIssue === null ||
          SOFT_RANK[softIssue] > SOFT_RANK[softResult.kind] ||
          // 둘 다 용어가 모자라면 더 많이 반영한 쪽(예: 원문 2곳 중 0곳 → 1곳).
          (softIssue === 'glossary' &&
            softResult.kind === 'glossary' &&
            glossaryHitCount(result.refined, input.glossary, input.text) >
              glossaryHitCount(softResult.result.refined, input.glossary, input.text));
        if (!secondIsBetter) {
          keepSoftResult();
          break;
        }
        issues = [...issues, `${softResult.kind}-retried`];
        // 화면의 「직전 대화 N개 참고함」은 실제로 실린 개수다 — 이 결과는 대화 참고 없이 나왔다.
        if (softResult.kind === 'glossary') contextCount = 0;
      }
      if (contentAttempts > 0) issues = [...issues, 'content-retried'];
      if (transientRetried) issues = [...issues, 'transient-retried'];
      break;
    }
    // 약한 검사 재호출이 내용 검사에 걸리면 — 교정문이 쓸 만하던 첫 결과를 준다.
    if (softResult) {
      keepSoftResult();
      break;
    }
    // 🔴 끝까지 걸리면 `invalid` 폴백 — 캐시하지 않고, 확장의 `invalid` 자동 재시도 한 번을 탄다.
    //    로그에는 사유 코드만 — 교정문은 싣지 않는다(Zero Retention).
    contentAttempts += 1;
    if (contentAttempts >= MAX_CONTENT_ATTEMPTS || !canRetry()) {
      const fallbackResult = buildFallbackResponse(input, FALLBACK_REASONS.INVALID);
      logger({ event: 'refine', cacheHit: false, fallback: true, fallbackReason: FALLBACK_REASONS.INVALID, issues: [...issues, contentIssue], attempt, latencyMs: now() - startedAt });
      return fallbackResult;
    }
  }

  /**
   * S21 — 화면의 "직전 대화 N개 참고함"이 쓰는 값 (Spec 권장 8).
   * 🔴 클라이언트가 보낸 개수가 아니라 **실제로 프롬프트에 실린 개수**를 돌려준다 — 서버가
   *    상한으로 잘라냈는데 화면이 보낸 개수를 말하면 그건 거짓 표시다.
   * 🔴 개수뿐이다. 맥락 본문은 응답에도 싣지 않는다.
   */
  result.threadContextCount = contextCount;
  // 🔴 「적용됨」은 모델 신고가 아니라 등록된 말로 판정한다(`glossaryVerify.js` 판정표).
  result = reconcileAppliedGlossary(result, input.glossary, input.text);

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
    threadContextCount: contextCount,
    issues,
    latencyMs: now() - startedAt,
  });

  return { ...result, cached: false };
}

/** 모듈 수준 기본 캐시 — 프로세스 메모리 전용(cache.js의 Zero Retention 경계 주석 참조). */
const defaultCache = new MemoryCacheStore();
