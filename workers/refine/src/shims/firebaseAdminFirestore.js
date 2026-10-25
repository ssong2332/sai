/**
 * `firebase-admin/firestore` 대역 (2026-10-26, L33 2단계) — Worker 번들과 Worker 테스트에서만 쓴다.
 *
 * 🔴 왜: `functions/*.js`의 판정 코드를 Worker가 그대로 부르려면 그 파일들의 `import { FieldValue } from
 *    'firebase-admin/firestore'`가 **REST 어댑터의 FieldValue**를 받아야 한다 — admin의 FieldValue를 받으면
 *    어댑터가 쓰기 변환으로 알아보지 못한다. `wrangler.toml` `[alias]`와 `test/sdkAlias.mjs`가 이 파일로 바꾼다.
 * 🔴 `getFirestore()`는 부르면 바로 던진다 — Worker는 db를 항상 deps로 넘긴다(기본값 경로로 새면 안 된다).
 */

export { FieldValue, Timestamp } from '../google/firestoreRest.js';

export function getFirestore() {
  throw new Error('Worker에서는 getFirestore()를 쓰지 않는다 — deps.db()로 RestFirestore를 넘긴다');
}
