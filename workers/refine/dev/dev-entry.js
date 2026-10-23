/**
 * 🔴 **로컬 확인 전용 진입점 — 배포 금지.** `wrangler.dev.toml`만 이 파일을 가리킨다(`wrangler.toml`은 `src/index.js`).
 *
 * 목적: 실제 workerd(로컬 `wrangler dev`) 안에서 **공유 코어 + Anthropic SDK + jose**가 로드·동작하는지 본다
 * (Node 테스트로는 Worker 런타임 호환성을 증명할 수 없다). 네트워크 없이 돌리려고 둘을 바꾼다:
 *   - JWKS: isolate 안에서 만든 로컬 키(`/__dev/token`이 그 키로 서명한 토큰을 준다)
 *   - Claude: 즉시 답하는 가짜 fetch(SDK는 실제 코드가 돈다 — 요청 조립·응답 파싱까지)
 * 🔴 `/__dev/token`은 아무에게나 유효 토큰을 준다 — 이 파일이 배포되면 인증이 사라진다. 그래서 운영 설정에서
 *    참조하지 않고, 응답에 `devOnly: true`를 붙인다.
 */

import { createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import { fakeAnthropicFetch, makeKeys, signIdToken } from '../test/helpers.js';

let ready = null;
function init() {
  // 🔴 전역 스코프에서는 비동기 작업을 못 하므로 첫 요청에서 만든다.
  ready ??= (async () => {
    const keys = await makeKeys('dev-kid');
    const fetchImpl = fakeAnthropicFetch();
    return { keys, fetchImpl, handle: createHandler({ jwks: keys.jwks, fetchImpl, usageStore: createMemoryUsageStore() }) };
  })();
  return ready;
}

export default {
  async fetch(request, env) {
    const { keys, fetchImpl, handle } = await init();
    const url = new URL(request.url);
    if (url.pathname === '/__dev/token') {
      return globalThis.Response.json({ devOnly: true, token: await signIdToken(keys) });
    }
    if (url.pathname === '/__dev/seen') {
      // 가짜 Claude가 받은 요청의 **모양**만(본문 텍스트 없음) — SDK가 workerd에서 무엇을 보냈는지 확인용.
      const last = fetchImpl.seen.bodies.at(-1);
      return globalThis.Response.json({
        devOnly: true,
        calls: fetchImpl.seen.calls,
        url: fetchImpl.seen.urls.at(-1) ?? null,
        model: last?.model ?? null,
        thinking: last?.thinking ?? null,
        hasTemperature: last ? 'temperature' in last : null,
        processEnvThinking: globalThis.process?.env?.SAI_ANTHROPIC_THINKING ?? null,
      });
    }
    return handle(request, env);
  },
};
