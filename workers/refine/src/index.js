/**
 * Cloudflare Worker 진입점 — 사이 교정 서버 1단계 시험판(L33). 🔴 배포하지 않았다.
 *
 * 운영 기본값: JWKS = Google securetoken 원격 키(isolate 캐시) · 상한/지표 = Firestore REST(2026-10-26, 시크릿 없으면 스텁) ·
 * fetch = Worker 전역 fetch(SDK 기본). 판정·라우팅은 전부 `handler.js`에 있다 — 테스트가 같은 코드를 부른다.
 */

import { createHandler } from './handler.js';
import { usageStoreFromEnv } from './usageStore.js';

// 상한·지표 = Firestore(시크릿 GOOGLE_SERVICE_ACCOUNT가 있을 때) — 표는 usageStore.js. 시크릿은 요청 env로만 온다.
const handle = createHandler({ usageStore: (env) => usageStoreFromEnv(env) });

export default {
  /** @param {Request} request @param {Record<string, unknown>} env */
  fetch(request, env) {
    return handle(request, env);
  },
};
