/**
 * 폴오버 사슬 — 한도에 걸렸을 때 **어느 순서로 갈아탈지** 정하는 단 하나의 표 (2026-08-20).
 *
 * 🔴 **왜 파일로 뺐나.** 예전에는 같은 규칙이 `server/refine-proxy.js`와 `functions/index.js`에
 *    **각각 적혀** 있었다. 이 프로젝트에서 「두 파일에 같은 표」는 이미 여러 번 어긋났고, 어긋나면
 *    증상이 「로컬에선 되는데 배포하면 다르다」로 나온다 — 가장 찾기 어려운 종류다.
 *    `scripts/sync-core.mjs`가 `src/core/refine/`를 통째로 복사하므로, 여기 두면 **두 서버가
 *    물리적으로 같은 파일**을 쓴다. 드리프트가 구조적으로 불가능해진다.
 *
 * 🔴 **모델별로 한도가 따로다** (2026-08-20 헤더 실측). 그래서 3단계가 성립한다 —
 *    `gpt-4o`가 바닥나도 **같은 OpenAI 키의 `gpt-4.1`은 별도 50건**을 갖는다:
 *      `x-ratelimit-remaining-requests`: gpt-4o **3** / gpt-4.1 **49** (같은 시점, 같은 키)
 *    이게 아니었다면 3단계는 의미가 없다(같은 통에서 또 퍼내는 셈이므로).
 *
 * 🔴 **`gpt-4.1`은 드롭인이다** — `temperature: 0`을 받는다(실측). gpt-5 계열은 **거부**하고
 *    기본값 1만 허용해서 결정성이 깨지므로 **사슬에 넣지 않는다**(Lessons #6: 같은 입력에 같은
 *    결과가 나와야 캐시·시연 재현성이 성립한다).
 *
 * 🔴 **넘어가는 조건은 좁다** — `runWithFailover` 쪽 판정표를 그대로 지킨다:
 *      ① 사유가 `quota`일 때만 (네트워크·형식 오류는 두 번 불러도 같은 이유로 실패한다)
 *      ② 요청이 provider를 **명시하지 않았을 때만**
 *      ③ 표에 남은 단계까지만
 */

/**
 * 갈아탈 순서. **위에서부터** 쓴다.
 * `model: null`은 「그 provider의 기본 모델」이라는 뜻이다 — 모델명을 박아 두면 provider의
 * 기본이 바뀌었을 때 여기만 옛 이름으로 남는다.
 *
 * | 순서 | provider | 모델 | 하루 한도(무료, 2026-08-20 실측) |
 * |---|---|---|---|
 * | 1 | openai | 기본 (`gpt-4o`) | 50 |
 * | 2 | gemini | 기본 | 20 |
 * | 3 | openai | `gpt-4.1` | 50 (**1번과 별도 통**) |
 */
export const FAILOVER_CHAIN = [
  { provider: 'openai', model: null },
  { provider: 'gemini', model: null },
  { provider: 'openai', model: 'gpt-4.1' },
];

/** 두 단계가 같은가 — provider와 모델이 **둘 다** 같아야 같다. */
export function sameStep(a, b) {
  return (a?.provider ?? null) === (b?.provider ?? null) && (a?.model ?? null) === (b?.model ?? null);
}

/**
 * 지금 쓴 단계 다음에 시도할 목록.
 *
 * 🔴 **규칙: 표 순서대로 내려가되, 이미 쓴 것과 같은 단계는 건너뛴다.**
 *    「표에서의 위치 이후」가 아니라 「같은 것 제외」로 정의한다 — 1번이 아닌 단계에서 시작한
 *    경우(예: OpenAI 키가 없어 gemini가 1차)에도 규칙이 그대로 성립해야 하기 때문이다.
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
