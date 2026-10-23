/**
 * Worker 설정 읽기 — `wrangler.toml` `[vars]`와 시크릿에서만 읽는다.
 *
 * 🔴 프로젝트 ID·확장 ID를 로직에 하드코딩하지 않는다 — 스테이징 프로젝트·다른 확장 ID로 시험할 때
 *    코드를 고치면 "시험한 것과 배포한 것이 다르다"가 시작된다.
 * 🔴 값이 없으면 **조용히 기본값을 지어내지 않는다** — 설정 누락은 500으로 드러낸다(`handler.js`).
 *    특히 프로젝트 ID가 비면 issuer·audience 검사가 무의미해진다.
 * 🔴 provider 키(2026-10-23 — 폴오버): 코어 `PROVIDERS[*].envKey`와 **같은 이름**의 Worker 시크릿에서 읽는다.
 *    안내하는 시크릿은 사슬 두 개(`ANTHROPIC_API_KEY`·`GROQ_API_KEY`)뿐이다. 없는 키는 null — 그 단계는 건너뛴다.
 *    이름 표를 여기 다시 적지 않는다(코어와 어긋나면 키가 있는데도 「없음」이 된다).
 */

import { PROVIDERS } from '../../../src/core/refine/index.js';

/** Google securetoken 공개키(JWK). Firebase ID 토큰 서명 검증용 — firebase-admin이 쓰는 것과 같은 키 묶음. */
export const SECURETOKEN_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * @param {Record<string, unknown>} env Worker env (vars + secrets).
 * @returns {{ projectId: string|null, extensionId: string|null, keys: Record<string, string|null>,
 *   anthropicModel: string|undefined, thinking: string|undefined, missing: string[] }}
 */
export function readConfig(env = {}) {
  const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
  const projectId = str(env.FIREBASE_PROJECT_ID);
  const extensionId = str(env.EXTENSION_ID);
  const keys = Object.fromEntries(Object.entries(PROVIDERS).map(([name, entry]) => [name, str(env[entry.envKey])]));
  const missing = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!extensionId) missing.push('EXTENSION_ID');
  return {
    projectId,
    extensionId,
    keys,
    // 🔴 anthropic 단계에만 적용한다 — 다른 provider에 Claude 모델명을 주면 그쪽에서 또 실패한다.
    anthropicModel: str(env.ANTHROPIC_MODEL) ?? undefined,
    thinking: str(env.SAI_ANTHROPIC_THINKING) ?? undefined,
    missing,
  };
}
