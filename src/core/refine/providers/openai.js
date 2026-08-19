/**
 * OpenAI provider — `docs/Spec.md` §6-3의 **기준 provider**(배포·제출 경로).
 * 단일 호출로 구조화 JSON을 받는다 (Spec §6-3 — 순차 호출 금지).
 *
 * 구 프로젝트 `openai.ts`와 같은 형태 — 시스템 메시지를 따로 만들지 않고 payload 전체를
 * 단일 user 메시지의 JSON 본문으로 보낸다(지시문은 payload 안에 있다).
 *
 * 🔴 API 키는 이 파일에도, 어떤 문서·커밋에도 쓰지 않는다. 호출자가 주입한다.
 * 🔴 메시지 본문을 로그·에러 메시지에 담지 않는다 (Spec 필수 5 Zero Retention).
 */

import { FALLBACK_REASONS } from '../fallback.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o';
export const DEFAULT_TIMEOUT_MS = 20_000;

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * @param {object} payload buildRefinePayload()의 반환값.
 * @param {object} deps
 * @param {string} deps.apiKey OpenAI API 키 (환경변수에서 호출자가 주입).
 * @param {string} [deps.model]
 * @param {number} [deps.timeoutMs]
 * @param {typeof fetch} [deps.fetchImpl] 테스트에서 주입.
 * @param {object} deps.errors `providers/index.js`가 넘기는 { RefineCallError, classifyHttpFailure, parseJsonContent }.
 * @returns {Promise<object>} 파싱된 LLM JSON (검증은 schema.js가 한다).
 */
export async function callOpenAI(
  payload,
  { apiKey, model = DEFAULT_OPENAI_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, errors },
) {
  const { RefineCallError, classifyHttpFailure, parseJsonContent } = errors;

  if (!apiKey) throw new RefineCallError(FALLBACK_REASONS.ERROR, 'missing api key');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // 결정성 — 같은 입력에 같은 결과를 내야 캐시·데모 재현성이 성립한다(Lessons #6).
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    // AbortError(타임아웃) 포함 — 네트워크 계열은 전부 일시 장애로 분류한다.
    throw new RefineCallError(FALLBACK_REASONS.ERROR, error?.name ?? 'network');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let errorCode;
    try {
      const body = await response.json();
      errorCode = body?.error?.code ?? body?.error?.type;
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

  return parseJsonContent(body?.choices?.[0]?.message?.content);
}
