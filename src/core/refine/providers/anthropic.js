/**
 * Anthropic(Claude) provider — 🔴 **2026-10-23부터 기본 provider다** (사용자 결정, Spec §0 · Tasks L30).
 * 폴오버 사슬 1번(`failover.js` — anthropic → groq). 같은 날 시험용 옵션으로 붙였다가 L30 실측 후 기본이 됐다.
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
 * 실제 사용 토큰 누계 (2026-10-23 L30 — Sai 전용 키로 건당 실제 비용을 재기 위해).
 * 🔴 **숫자만 모은다** — 본문·응답은 담지 않는다(Spec 필수 5). 프로세스 메모리 전용이며,
 *    회귀 러너(`scripts/refine-live.js`)가 실행 끝에 합계를 출력한다. 서버에서는 읽는 곳이 없다.
 */
export const anthropicUsage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * 🔴 사고(thinking) 스위치 — **기본은 끈다** (2026-10-23 사용자 결정, L30 실측 근거).
 *    L30: 사고 끔 건당 $0.00070·중앙값 2.4~2.5초 / 켬(파라미터 생략 = 모델 기본) $0.00107·6.2~6.7초.
 *    Haiku 5.5는 effort `high` 이하에서만 `disabled`를 받는다(여기는 `low`).
 *
 * | `SAI_ANTHROPIC_THINKING` | 보내는 것 | 용도 |
 * |---|---|---|
 * | 없음 · `disabled` · 그 밖의 값 | `thinking: {type:'disabled'}` | 기본(운영) — 오타가 비용·지연을 3배로 올리지 않게 모르는 값도 끔 |
 * | `adaptive` | `thinking` 생략(모델 기본) | 실험 전용 — L30의 「켬」 측정과 같은 조건 · 품질 모드 표(`quality.js`) |
 * | `between_tools` | `thinking: {type:'between_tools'}` | 품질 모드 표 전용 — Sonnet 5.5는 `disabled`가 400이라 이것이 「끔」이다(effort `high` 이하만) |
 */
export const THINKING_ON_VALUE = 'adaptive';
export const THINKING_BETWEEN_TOOLS = 'between_tools';

/**
 * effort 판정표 (2026-10-30 품질 모드). 🔴 표 밖 값·없음은 `low` — 오타가 지연을 늘리지 않게.
 * | `deps.effort` | 보내는 값 |
 * |---|---|
 * | `low` · `medium` · `high` | 그 값 |
 * | 그 밖 · 없음 | `low`(이전과 같다) |
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high'];
export function effortValue(value) {
  return EFFORT_LEVELS.includes(value) ? value : 'low';
}
/**
 * 값의 출처 판정표 (2026-10-24 L33 — Worker 콜드 CPU 절감)
 * | `deps.thinking` | 읽는 값 | 쓰는 곳 |
 * |---|---|---|
 * | `undefined`(안 넘김) | `process.env.SAI_ANTHROPIC_THINKING` | Node 경로(프록시·Functions·회귀 러너) — 이전과 같다 |
 * | 그 밖(문자열·null 등) | 그 값 — `process`를 **건드리지 않는다** | Worker — 요청 중 `globalThis.process` 첫 접근이 Node 호환 내부를 늦게 불러 +3ms(로컬 workerd 실측) |
 * 🔴 어느 쪽이든 위 표 그대로 `adaptive`만 켬 — 오타·null은 끔.
 */
function thinkingConfig(explicit) {
  const value = explicit === undefined ? globalThis.process?.env?.SAI_ANTHROPIC_THINKING : explicit;
  if (value === THINKING_ON_VALUE) return {};
  if (value === THINKING_BETWEEN_TOOLS) return { thinking: { type: THINKING_BETWEEN_TOOLS } };
  return { thinking: { type: 'disabled' } };
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
 * @param {string} [deps.thinking] 사고 스위치 — 위 `thinkingConfig` 판정표. 생략하면 `process.env`를 읽는다.
 * @param {string} [deps.effort] 위 effort 판정표. 생략하면 `low`.
 * @param {object} deps.errors `providers/index.js`가 넘기는 { RefineCallError, classifyHttpFailure, parseJsonContent }.
 * @returns {Promise<object>} 파싱된 LLM JSON (검증은 schema.js가 한다).
 */
export async function callAnthropic(
  payload,
  { apiKey, model = DEFAULT_ANTHROPIC_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl, thinking, effort, errors },
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
      // 교정은 짧은 변환이다 — 기본은 사고 깊이를 낮춰 지연·비용을 줄인다(Haiku 5.5 기본값은 medium). 품질 모드가 올릴 수 있다.
      output_config: { effort: effortValue(effort) },
      ...thinkingConfig(thinking),
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

  const usage = response?.usage ?? {};
  anthropicUsage.calls += 1;
  anthropicUsage.input += usage.input_tokens ?? 0;
  anthropicUsage.output += usage.output_tokens ?? 0;
  anthropicUsage.cacheRead += usage.cache_read_input_tokens ?? 0;
  anthropicUsage.cacheWrite += usage.cache_creation_input_tokens ?? 0;

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
