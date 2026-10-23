/**
 * Worker 설정 읽기 — `wrangler.toml` `[vars]`와 시크릿에서만 읽는다.
 *
 * 🔴 프로젝트 ID·확장 ID를 로직에 하드코딩하지 않는다 — 스테이징 프로젝트·다른 확장 ID로 시험할 때
 *    코드를 고치면 "시험한 것과 배포한 것이 다르다"가 시작된다.
 * 🔴 값이 없으면 **조용히 기본값을 지어내지 않는다** — 설정 누락은 500으로 드러낸다(`handler.js`).
 *    특히 프로젝트 ID가 비면 issuer·audience 검사가 무의미해진다.
 */

/** Google securetoken 공개키(JWK). Firebase ID 토큰 서명 검증용 — firebase-admin이 쓰는 것과 같은 키 묶음. */
export const SECURETOKEN_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * @param {Record<string, unknown>} env Worker env (vars + secrets).
 * @returns {{ projectId: string|null, extensionId: string|null, anthropicKey: string|null,
 *   model: string|undefined, thinking: string|undefined, missing: string[] }}
 */
export function readConfig(env = {}) {
  const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
  const projectId = str(env.FIREBASE_PROJECT_ID);
  const extensionId = str(env.EXTENSION_ID);
  const anthropicKey = str(env.ANTHROPIC_API_KEY);
  const missing = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!extensionId) missing.push('EXTENSION_ID');
  return {
    projectId,
    extensionId,
    anthropicKey,
    model: str(env.ANTHROPIC_MODEL) ?? undefined,
    thinking: str(env.SAI_ANTHROPIC_THINKING) ?? undefined,
    missing,
  };
}
