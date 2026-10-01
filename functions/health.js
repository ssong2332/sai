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

/** 판정 순서와 같게 둔다 — `index.js` `resolveProviderAndKey`의 미지정 기본 순서(2026-10-01 L03: gemini 먼저). */
const PROVIDER_ORDER = ['gemini', 'openai'];

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
  };
}
