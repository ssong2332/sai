/**
 * `firebase-admin/auth` 대역 (2026-10-26, L33 2단계) — Worker 번들과 Worker 테스트에서만 쓴다.
 * 🔴 `getAuth()`는 부르면 바로 던진다 — Worker는 토큰 검증(`auth.js`)과 계정 삭제를 deps로 넘긴다.
 */

export function getAuth() {
  throw new Error('Worker에서는 getAuth()를 쓰지 않는다 — deps로 넘긴다');
}
