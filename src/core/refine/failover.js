/**
 * 폴오버 사슬 — 한도에 걸렸을 때 **어느 순서로 갈아탈지** 정하는 단 하나의 표 (2026-08-20).
 *
 * 🔴 **왜 파일로 뺐나.** 예전에는 같은 규칙이 `server/refine-proxy.js`와 `functions/index.js`에
 *    **각각 적혀** 있었다. 이 프로젝트에서 「두 파일에 같은 표」는 이미 여러 번 어긋났고, 어긋나면
 *    증상이 「로컬에선 되는데 배포하면 다르다」로 나온다 — 가장 찾기 어려운 종류다.
 *    `scripts/sync-core.mjs`가 `src/core/refine/`를 통째로 복사하므로, 여기 두면 **두 서버가
 *    물리적으로 같은 파일**을 쓴다. 드리프트가 구조적으로 불가능해진다.
 *
 * 🔴 **모델별로 한도가 따로다** (2026-08-20 헤더 실측 — 당시 사슬 기준, 지금 사슬에는 OpenAI가 없다). 그래서 3단계가 성립했다 —
 *    `gpt-4o`가 바닥나도 **같은 OpenAI 키의 `gpt-4.1`은 별도 50건**을 갖는다:
 *      `x-ratelimit-remaining-requests`: gpt-4o **3** / gpt-4.1 **49** (같은 시점, 같은 키)
 *    이게 아니었다면 3단계는 의미가 없다(같은 통에서 또 퍼내는 셈이므로).
 *
 * 🔴 **`gpt-4.1`은 드롭인이다** — `temperature: 0`을 받는다(실측). gpt-5 계열은 **거부**하고
 *    기본값 1만 허용해서 결정성이 깨지므로 **사슬에 넣지 않는다**(Lessons #6: 같은 입력에 같은
 *    결과가 나와야 캐시·시연 재현성이 성립한다).
 *
 * 🔴 **넘어가는 조건은 좁다** — `runWithFailover` 쪽 판정표를 그대로 지킨다:
 *      ① 사유가 `quota` 또는 `auth`일 때만 (네트워크·형식 오류는 두 번 불러도 같은 이유로 실패한다)
 *      ② 요청이 provider를 **명시하지 않았을 때만**
 *      ③ 표에 남은 단계까지만
 *    `auth`(키 무효)는 2026-10-12 L15에서 추가(사용자 결정) — 키는 provider마다 따로라 다음 단계는
 *    살아 있을 수 있고, 401·키 무효 400은 한도를 쓰지 않으므로 넘겨도 비용이 없다.
 */

/** 다음 단계로 넘기는 사유. 🔴 두 서버가 이 함수만 본다 — 각자 문자열을 비교하지 않는다. */
export const FAILOVER_REASONS = ['quota', 'auth'];

/** 이 결과면 사슬의 다음 단계로 넘어가는가. 성공(`fallback` 아님)이면 넘기지 않는다. */
export function shouldFailOver(result) {
  return result?.fallback === true && FAILOVER_REASONS.includes(result.fallbackReason);
}

/**
 * 갈아탈 순서. **위에서부터** 쓴다.
 * `model: null`은 「그 provider의 기본 모델」이라는 뜻이다 — 모델명을 박아 두면 provider의
 * 기본이 바뀌었을 때 여기만 옛 이름으로 남는다.
 *
 * 🔴 **2026-10-23 — anthropic(Claude) → groq 두 단계다** (사용자 결정, Spec §0 · Tasks L30).
 *    근거 ① L30 실측: Claude Haiku 5.5 사고 끔 — 건당 $0.00070·중앙값 2.4~2.5초, 교정 규칙 반복 측정 통과.
 *    근거 ② 데이터 정책: Anthropic API 입력은 기본적으로 학습에 쓰지 않고, Groq는 계약상 학습 금지 +
 *    무보존(ZDR, 콘솔 Data Controls)이 가능하다. **Gemini 무료 티어는 입력을 학습에 쓴다**(Tasks L02) —
 *    그래서 Gemini는 예비로도 두지 않는다(사용자 결정 (b)). Gemini·OpenAI provider 코드는 남는다 —
 *    `provider: 'gemini'`처럼 **명시하면** 계속 쓸 수 있고, 명시 요청은 폴오버하지 않는다.
 *
 * 이력(위가 최신):
 * | 날짜 | 순서 | 바꾼 이유 |
 * |---|---|---|
 * | 2026-10-23 | anthropic → groq | 위 근거 ①② (OpenAI 키는 2026-09-28부터 무효라 뺐다 — Groq가 openai 코드를 재사용한다) |
 * | 2026-10-01 L03 | gemini → openai → openai/gpt-4.1 | 무효 OpenAI 키를 먼저 골라 확장이 gemini를 강제해야 했다 — 강제(명시)는 폴오버를 끈다 |
 * | 2026-08-20 | openai → gemini → openai/gpt-4.1 | 한도가 모델별로 따로라는 실측(위 헤더) |
 *
 * | 순서 | provider | 모델 | 비고 |
 * |---|---|---|---|
 * | 1 | anthropic | 기본 (`claude-haiku-5-5`, 사고 끔 — `providers/anthropic.js`) | 유료 크레딧 — 소진은 `billing_error` → quota |
 * | 2 | groq | 기본 (`openai/gpt-oss-120b`) | 무료 티어 한도 🔴 미실측 |
 */
export const FAILOVER_CHAIN = [
  { provider: 'anthropic', model: null },
  { provider: 'groq', model: null },
];

/**
 * **기본 provider 순서** — 사슬에서 provider만 순서대로 뽑은 것(중복 제거).
 * 🔴 로컬 프록시·회귀 러너·Functions·Worker 네 곳이 **이것 하나로** 기본값을 고른다
 *    (CLAUDE.md 「셋의 기본값 순서는 항상 같아야 한다」). 각자 `process.env.X ? 'x' : 'y'`를 적으면
 *    하나만 바뀌어 어긋난다 — 2026-10-01 L03까지는 실제로 그렇게 적혀 있었다.
 */
export const DEFAULT_PROVIDER_ORDER = [...new Set(FAILOVER_CHAIN.map((step) => step.provider))];

/**
 * 키가 있는 첫 provider. 판정표:
 * | ANTHROPIC 키 | GROQ 키 | 결과 |
 * |---|---|---|
 * | 있음 | — | anthropic |
 * | 없음 | 있음 | groq |
 * | 없음 | 없음 | **null** — 사슬 밖 provider(gemini·openai)로 **대체하지 않는다** |
 *
 * @param {(provider: string) => boolean} hasKey provider 이름 → 키가 있는가. 🔴 키 값은 받지 않는다.
 * @returns {string|null}
 */
export function pickDefaultProvider(hasKey) {
  return DEFAULT_PROVIDER_ORDER.find((provider) => hasKey(provider)) ?? null;
}

/** 두 단계가 같은가 — provider와 모델이 **둘 다** 같아야 같다. */
export function sameStep(a, b) {
  return (a?.provider ?? null) === (b?.provider ?? null) && (a?.model ?? null) === (b?.model ?? null);
}

/**
 * 지금 쓴 단계 다음에 시도할 목록.
 *
 * 🔴 **규칙: 표 순서대로 내려가되, 이미 쓴 것과 같은 단계는 건너뛴다.**
 *    「표에서의 위치 이후」가 아니라 「같은 것 제외」로 정의한다 — 1번이 아닌 단계에서 시작한
 *    경우(예: ANTHROPIC 키가 없어 groq가 1차, 또는 Functions 임시 gemini)에도 규칙이 그대로 성립해야 하기 때문이다.
 *
 * @param {{provider: string, model?: string|null}} current 방금 실패한 단계.
 * @returns {{provider: string, model: string|null}[]} 시도할 순서대로.
 */
export function remainingChain(current) {
  return FAILOVER_CHAIN.filter((step) => !sameStep(step, current));
}

/** 로그·응답에 쓸 표기. 🔴 키는 절대 넣지 않는다. */
export function stepLabel(step) {
  return step?.model ? `${step.provider}/${step.model}` : String(step?.provider ?? '?');
}
