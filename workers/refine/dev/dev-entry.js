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
import { fakeAnthropicFetch, goodRaw, makeKeys, signIdToken } from '../test/helpers.js';

/**
 * mode별 가짜 Claude 응답(2026-10-24 — decode·decisions·reply 이식 확인용). 합성 데이터 — 각 코어 schema를 통과하는 최소 모양.
 * 들어온 요청의 `mode`로 고른다(모르는 값은 refine — handler와 같다). 동시 요청은 가정하지 않는다(로컬 확인 전용).
 */
const DEV_RAW = {
  refine: goodRaw(),
  decode: {
    literalTranslation: '업데이트 고마워요! 사소한 코멘트가 몇 개 있어요.',
    actualIntent: '접근 방식 재검토를 요구하고 있을 가능성이 높습니다.',
    intentEvidence: '"a few minor comments"',
    surfaceUrgency: 'LOW',
    actualUrgency: 'CRITICAL',
    urgencyReason: '표면상 가볍지만 실질 요구가 있습니다.',
    urgencyEvidence: 'revisit the overall approach',
    requiredActions: ['재검토안 준비'],
  },
  decisions: {
    decisions: [
      { decision: '금요일에 배포한다', owner: 'Jin', dueDate: 'Friday', authorityStatus: '확정', authorityEvidence: '"Friday works."' },
    ],
  },
  reply: { draft: '네, 검토하겠습니다.', placeholderNote: '' },
};

let ready = null;
function init() {
  // 🔴 전역 스코프에서는 비동기 작업을 못 하므로 첫 요청에서 만든다.
  ready ??= (async () => {
    const keys = await makeKeys('dev-kid');
    const fakes = Object.fromEntries(Object.entries(DEV_RAW).map(([mode, raw]) => [mode, fakeAnthropicFetch(raw)]));
    const state = { mode: 'refine' };
    const fetchImpl = (url, init) => fakes[state.mode](url, init);
    Object.defineProperty(fetchImpl, 'seen', { get: () => fakes[state.mode].seen });
    const handle = createHandler({ jwks: keys.jwks, fetchImpl, usageStore: createMemoryUsageStore() });
    return { keys, fetchImpl, state, handle };
  })();
  return ready;
}

export default {
  async fetch(request, env) {
    const { keys, fetchImpl, state, handle } = await init();
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/refine') {
      const mode = await request
        .clone()
        .json()
        .then((b) => b?.mode)
        .catch(() => undefined);
      state.mode = Object.hasOwn(DEV_RAW, mode) ? mode : 'refine';
    }
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
