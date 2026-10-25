/**
 * Node에서 `wrangler.toml` `[alias]`를 똑같이 흉내 낸다 (2026-10-23 L33 · 2026-10-26 firebase-admin 대역 추가).
 *
 * | 지정자 | 대역 |
 * |---|---|
 * | `@anthropic-ai/sdk` | `src/anthropicFetch.js` |
 * | `firebase-admin/firestore` | `src/shims/firebaseAdminFirestore.js` (REST 어댑터의 FieldValue) |
 * | `firebase-admin/auth` | `src/shims/firebaseAdminAuth.js` |
 *
 * 🔴 왜: Worker 테스트·벤치는 Node에서 돈다. alias가 없으면 **진짜 SDK·firebase-admin**을 불러, 배포본(대역)과 다른 코드를
 *    시험하게 된다 — 「테스트 green인데 배포본은 다르다」. 그래서 `npm test`·`bench:*`는 전부 `--import`로 이 파일을 싣는다.
 *    대역이 실제로 걸렸는지는 `test/anthropicFetch.test.js` 첫 테스트와 `test/firestoreRest.test.js`가 잠근다.
 * 🔴 bare 지정자 **이 셋만** 바꾼다(하위 경로는 그대로 둔다).
 */

import { register } from 'node:module';

const map = {
  '@anthropic-ai/sdk': new URL('../src/anthropicFetch.js', import.meta.url).href,
  'firebase-admin/firestore': new URL('../src/shims/firebaseAdminFirestore.js', import.meta.url).href,
  'firebase-admin/auth': new URL('../src/shims/firebaseAdminAuth.js', import.meta.url).href,
};
const hooks = `
const MAP = ${JSON.stringify(map)};
export async function resolve(specifier, context, next) {
  if (Object.hasOwn(MAP, specifier)) return { url: MAP[specifier], shortCircuit: true };
  return next(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
