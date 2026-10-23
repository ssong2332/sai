/**
 * `GET /health` 응답 조립 (L13 — 2026-09-30).
 *
 * 🔴 **순수 함수다** — `index.js`는 firebase-admin을 초기화하므로 테스트에서 import할 수 없다.
 *    판정은 여기 두고 `index.js`는 시크릿 값을 읽어 넘기기만 한다(`teams.js`와 같은 구조).
 * 🔴 **키 값은 절대 응답에 싣지 않는다.** 받는 것은 키 값이지만 내보내는 것은 provider **이름**뿐이다.
 * 🔴 `availableProviders`는 **「이 배포에 시크릿이 등록된 provider」**다 — 키가 유효한지는 모른다
 *    (2026-09-28처럼 등록된 OpenAI 키가 무효일 수 있다). 유효성은 실제 호출 로그의 `fallback=` 사유로 본다.
 *    예전에는 `['gemini']`로 하드코딩돼 있어 OpenAI 시크릿을 등록해도 빠져 보였다.
 */

/**
 * 보고 순서 — 기본 사슬(anthropic → groq) 다음에 사슬 밖 provider (2026-10-23).
 * 🔴 `core/refine/failover.js`를 import하지 않는다 — `functions/core/`는 sync-core가 만드는 복사본이라
 *    루트 테스트(`test/health.unit.test.js`)에서는 없을 수 있다. 대신 `test/providerDefaults.unit.test.js`가
 *    앞 두 칸이 `DEFAULT_PROVIDER_ORDER`와 같은지 잠근다.
 */
export const CHAIN_PROVIDERS = ['anthropic', 'groq'];
const PROVIDER_ORDER = [...CHAIN_PROVIDERS, 'gemini', 'openai'];

/**
 * @param {{ selected: { provider: string } | null, keys: Record<string, string | null> }} input
 *   `selected`는 `resolveProviderAndKey(undefined)`의 결과, `keys`는 provider → 키 값(없으면 null).
 */
export function healthPayload({ selected, keys }) {
  return {
    ok: true,
    provider: selected?.provider ?? null,
    availableProviders: PROVIDER_ORDER.filter((name) => Boolean(keys?.[name])),
    configured: selected !== null && selected !== undefined,
    // 🔴 사슬 밖 provider가 기본으로 쓰이는 중인가 — Functions 임시 기본(gemini, `index.js`
    //    `INTERIM_DEFAULT_PROVIDER`)이면 true. 사슬 시크릿을 등록하고 배포하면 false가 돼야 한다.
    interim: Boolean(selected?.provider) && !CHAIN_PROVIDERS.includes(selected.provider),
  };
}
