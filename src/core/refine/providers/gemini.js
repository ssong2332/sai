/**
 * Gemini provider — **로컬 개발/테스트 전용** (사용자 결정, 2026-08-12).
 * 배포 경로의 기준 provider는 `docs/Spec.md` §6-3대로 OpenAI다(`providers/index.js` 헤더 참조).
 *
 * API 형태 근거 (2026-08-12 확인, ai.google.dev/gemini-api 문서):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   헤더  x-goog-api-key: <KEY>
 *   본문  { contents: [{ parts: [{ text }] }], generationConfig: { responseMimeType, temperature } }
 *   응답  { candidates: [{ content: { parts: [{ text }] }, finishReason }] }
 *
 * 🔴 API 키는 이 파일에도, 어떤 문서·커밋에도 쓰지 않는다. 호출자가 주입한다.
 * 🔴 메시지 본문을 로그·에러 메시지에 담지 않는다 (Spec 필수 5 Zero Retention).
 */

import { FALLBACK_REASONS } from '../fallback.js';

/**
 * 기본 모델. 2026-08-12 실측으로 고른 값이다.
 *
 * 🔴 `gemini-2.5-*`는 쓰지 않는다 — ListModels 목록에는 나오지만 신규 키의 generateContent
 *    호출은 404로 막힌다("no longer available to new users", 2026-08-12·13 실측: 2.5-flash,
 *    2.5-flash-lite, 2.5-pro 전부 404).
 * 🔴 `gemini-flash-latest` 같은 별칭도 쓰지 않는다 — 별칭이 조용히 바뀌면 캐시·데모 재현성이
 *    깨진다(Lessons #6). 버전을 고정한다.
 *
 * ## 모델 선택 실측 (2026-08-13, 동일 payload 6,481자)
 * | 모델 | 응답 | Spec §6-3 "3~5초" |
 * |---|---|---|
 * | `gemini-3.5-flash-lite` | 2.5초 | ✅ **채택** |
 * | `gemini-3.1-flash-lite` | 3.3초 | ✅ 대안 |
 * | `gemini-3-flash-preview` | **186초** | ❌ 사용 불가 |
 * | `gemini-3.6-flash` | 정상이나 무료 한도 20건 소진 | — |
 *
 * 🔴 **무료 티어 한도는 모델당 20건**(`GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
 *    2026-08-13 429 응답 실측). 20건짜리 회귀 세트를 한 번 돌리면 그 모델은 그날 소진된다 —
 *    반복 실행하려면 모델을 바꾸거나 유료 전환이 필요하다.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_TIMEOUT_MS = 20_000;

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * @param {object} payload buildRefinePayload()의 반환값.
 * @param {object} deps
 * @param {string} deps.apiKey Gemini API 키 (환경변수에서 호출자가 주입).
 * @param {string} [deps.model]
 * @param {number} [deps.timeoutMs]
 * @param {typeof fetch} [deps.fetchImpl] 테스트에서 주입.
 * @param {object} deps.errors `providers/index.js`가 넘기는 { RefineCallError, classifyHttpFailure, parseJsonContent }.
 * @returns {Promise<object>} 파싱된 LLM JSON (검증은 schema.js가 한다).
 */
export async function callGemini(
  payload,
  { apiKey, model = DEFAULT_GEMINI_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, errors },
) {
  const { RefineCallError, classifyHttpFailure, parseJsonContent } = errors;

  if (!apiKey) throw new RefineCallError(FALLBACK_REASONS.ERROR, 'missing api key');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(`${BASE_URL}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        // OpenAI 경로와 동일하게 payload 전체를 단일 텍스트 파트의 JSON 본문으로 보낸다 —
        // 두 provider가 같은 프롬프트를 받아야 캐시 키·회귀 비교가 성립한다.
        contents: [{ parts: [{ text: JSON.stringify(payload) }] }],
        generationConfig: {
          // 결정성 — 같은 입력에 같은 결과를 내야 캐시·데모 재현성이 성립한다(Lessons #6).
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new RefineCallError(FALLBACK_REASONS.ERROR, error?.name ?? 'network');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let errorCode;
    try {
      const body = await response.json();
      errorCode = body?.error?.status ?? body?.error?.code;
    } catch {
      errorCode = undefined;
    }
    throw new RefineCallError(
      classifyHttpFailure(response.status, errorCode),
      `http ${response.status}`,
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new RefineCallError(FALLBACK_REASONS.INVALID, 'non-json body');
  }

  // 안전 필터 차단은 200으로 오면서 후보가 비거나 finishReason이 SAFETY다 — 빈 결과로 오인하지 않는다.
  const blockReason = body?.promptFeedback?.blockReason;
  if (blockReason) throw new RefineCallError(FALLBACK_REASONS.INVALID, `blocked: ${blockReason}`);

  const candidate = body?.candidates?.[0];
  if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
    throw new RefineCallError(FALLBACK_REASONS.INVALID, `finishReason ${candidate.finishReason}`);
  }

  // 🔴 thinking 계열 모델은 추론 파트(`thought: true`)를 함께 실어 보낸다 — 그대로 이어 붙이면
  //    JSON 앞에 추론 텍스트가 붙어 파싱이 깨진다. 응답 파트만 골라 잇는다.
  const content = (candidate?.content?.parts ?? [])
    .filter((part) => part?.thought !== true)
    .map((part) => part?.text ?? '')
    .join('');
  return parseJsonContent(content);
}
