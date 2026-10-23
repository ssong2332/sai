/**
 * Anthropic(Claude) provider — **시험용 옵션** (2026-10-23 사용자 결정, Tasks 참조).
 * 기본 provider 순서(gemini 우선)는 바꾸지 않는다 — `--provider anthropic`으로 명시할 때만 쓴다.
 *
 * API 형태 근거: 공식 SDK `@anthropic-ai/sdk` 1.1.0 (`client.d.ts` ClientOptions: apiKey·timeout(ms)·fetch·maxRetries,
 * `core/error.d.ts` APIError.status·type, `resources/shared.d.ts` ErrorType).
 *
 * 🔴 **`temperature`를 보내지 않는다.** 2026-10-21부터 Messages API는 `temperature`·`top_p`·`top_k`를
 *    보내면 모든 모델에서 400이다. 그래서 다른 provider와 달리 **같은 입력에 같은 결과가 보장되지 않는다**
 *    (Lessons #6) — 캐시는 첫 응답을 저장하므로 동작하지만, 회귀 비교는 완전 일치가 아니라 조건 충족으로 본다.
 * 🔴 구조화 출력(`output_config.format`)은 아직 쓰지 않는다 — 네 모드(refine·decode·decisions·reply)마다
 *    전체 스키마가 필요하다. 시험 단계에서는 다른 provider와 **같은 payload**를 보내고 검증은 `schema.js`가 한다.
 * 🔴 SDK는 **호출할 때만** 불러온다(동적 import) — 코어는 `sync-core`로 `functions/`에 복사되는데, 정적
 *    import면 Functions가 이 패키지 없이 로드조차 안 된다(배포 의존성을 지금 바꾸지 않는다).
 * 🔴 API 키는 이 파일·문서·커밋에 쓰지 않는다. 메시지 본문을 로그·에러에 담지 않는다(Spec 필수 5).
 */

import { FALLBACK_REASONS } from '../fallback.js';

/** 사용자 승인 모델(2026-10-23 — 「4번 제안」의 Claude Haiku 5.5). */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * 🔴 사고(thinking) 끄기 시험 스위치 (2026-10-23) — `SAI_ANTHROPIC_THINKING=disabled`일 때만 끈다.
 *    Haiku 5.5는 effort `high` 이하에서만 `disabled`를 받는다(여기는 `low`). 기본은 지금처럼 켜 둔다 —
 *    시험 결과로 기본값을 정한다(Tasks L30).
 */
function thinkingConfig() {
  return globalThis.process?.env?.SAI_ANTHROPIC_THINKING === 'disabled' ? { thinking: { type: 'disabled' } } : {};
}

/**
 * 응답 형태 + **이미 payload에 있는 규칙 중 Claude가 반복해서 어긴 것**을 다시 짚는다 (2026-10-23 L30).
 *
 * 🔴 새 규칙을 만들지 않는다 — 전부 `prompt.js`의 instruction에 이미 있다(APOLOGY_RULE·날짜 "Aug 4, YYYY"·
 *    glossaryRules·숫자 보존). 반복 측정(사고 켬 3회·끔 3회)에서 **같은 항목이 반복 실패**해서, Claude에게만
 *    「instruction의 규칙이 기본 습관보다 우선」이라고 한 번 더 말한다. Gemini 프롬프트는 건드리지 않는다.
 * 🔴 특정 시험 문장을 겨냥하지 않는다 — 규칙의 범주(군더더기·날짜·용어집·숫자)만 적는다.
 */
const SYSTEM = [
  'Respond with exactly one JSON object as specified in the request. No markdown code fences, no text before or after the JSON.',
  "The rules in the request's \"instruction\" override your own writing habits. In particular:",
  '- Numbers, units, amounts, times and durations in the original must all appear in the rewritten text, unchanged in value. Never drop one.',
  '- Write dates in the exact absolute format the instruction specifies, using the given reference year; never leave a numeric date like 8/4.',
  '- When a glossary entry matches the original, use its target text exactly and list it in "appliedGlossary".',
  '- Do not add hedges, cushioning phrases or apologies beyond what the instruction allows; translate Korean cushioning openers into plain, concise professional wording rather than literally.',
].join('\n');

/** 모델이 지시를 어기고 ```json 울타리를 붙였을 때만 벗긴다 — 본문은 건드리지 않는다. */
function stripFence(text) {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return match ? match[1] : text;
}

/**
 * @param {object} payload buildRefinePayload() 등의 반환값.
 * @param {object} deps
 * @param {string} deps.apiKey Anthropic API 키 (환경변수에서 호출자가 주입).
 * @param {string} [deps.model]
 * @param {number} [deps.timeoutMs]
 * @param {typeof fetch} [deps.fetchImpl] 테스트에서 주입 — SDK `fetch` 옵션으로 넘긴다.
 * @param {object} deps.errors `providers/index.js`가 넘기는 { RefineCallError, classifyHttpFailure, parseJsonContent }.
 * @returns {Promise<object>} 파싱된 LLM JSON (검증은 schema.js가 한다).
 */
export async function callAnthropic(
  payload,
  { apiKey, model = DEFAULT_ANTHROPIC_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl, errors },
) {
  const { RefineCallError, classifyHttpFailure, parseJsonContent } = errors;

  if (!apiKey) throw new RefineCallError(FALLBACK_REASONS.ERROR, 'missing api key');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // 🔴 재시도는 0 — 다른 provider와 같다. 한도·키 문제의 대체는 서버 폴오버가 맡는다(`failover.js`).
  const client = new Anthropic({
    apiKey,
    timeout: timeoutMs,
    maxRetries: 0,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 8000,
      // 교정은 짧은 변환이다 — 사고 깊이를 낮춰 지연·비용을 줄인다(Haiku 5.5 기본값은 medium).
      output_config: { effort: 'low' },
      ...thinkingConfig(),
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : undefined;
    if (status === undefined) {
      // 연결 실패·타임아웃(APIConnectionError 계열) — 일시 장애.
      throw new RefineCallError(FALLBACK_REASONS.ERROR, error?.name ?? 'network');
    }
    throw new RefineCallError(classifyHttpFailure(status, error?.type ?? undefined), `http ${status}`);
  }

  // 거절·잘림은 「형식에 맞는 답이 없다」로 본다.
  if (response?.stop_reason === 'refusal') throw new RefineCallError(FALLBACK_REASONS.INVALID, 'refusal');
  if (response?.stop_reason === 'max_tokens') throw new RefineCallError(FALLBACK_REASONS.INVALID, 'max_tokens');

  // 사고 블록(thinking)은 건너뛰고 text 블록만 모은다.
  const text = (response?.content ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('');
  return parseJsonContent(stripFence(text));
}
