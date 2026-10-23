/**
 * Node에서 `wrangler.toml` `[alias]`를 똑같이 흉내 낸다 — `@anthropic-ai/sdk` → `src/anthropicFetch.js` (2026-10-23 L33).
 *
 * 🔴 왜: Worker 테스트·벤치는 Node에서 돈다. alias가 없으면 코어가 **진짜 SDK**를 불러, 배포본(대역)과 다른 코드를
 *    시험하게 된다 — 「테스트 green인데 배포본은 다르다」. 그래서 `npm test`·`bench:*`는 전부 `--import`로 이 파일을 싣는다.
 *    대역이 실제로 걸렸는지는 `test/anthropicFetch.test.js` 첫 테스트가 잠근다(이 파일이 빠지면 실패).
 * 🔴 bare 지정자 `@anthropic-ai/sdk` **하나만** 바꾼다(하위 경로 `@anthropic-ai/sdk/...`는 코어가 안 쓴다 — 그대로 둔다).
 */

import { register } from 'node:module';

const target = new URL('../src/anthropicFetch.js', import.meta.url).href;
const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === '@anthropic-ai/sdk') return { url: ${JSON.stringify(target)}, shortCircuit: true };
  return next(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
