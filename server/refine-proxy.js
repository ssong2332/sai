#!/usr/bin/env node
/**
 * 로컬 `POST /v1/refine` 프록시 — **개발·데모 전용**.
 *
 * 왜 있나: S02(Firebase Functions)가 뜨기 전까지 확장이 부를 백엔드가 없다. 그렇다고 확장에
 * 키를 넣으면 안 된다(번들은 누구나 뜯어본다). 그래서 키를 쥔 서버를 로컬에 하나 띄운다.
 * `src/core/{refine,decode,decisions,reply}/`를 **그대로** 실행하며, `functions/index.js`와 같은
 * `mode` 라우팅 규칙을 쓴다(`decode`=수신 해독, `decisions`=결정 요약, `reply`=회신 초안, 그 외는 작성 교정) —
 * 로컬/배포가 갈리면 "로컬에선 되는데 배포하면 다르다"가 시작된다.
 *
 * 🔴 Zero Retention (Spec 필수 5): 요청 본문·교정문을 로그에 쓰지 않는다. 남기는 것은
 *    카운트·수치·플래그뿐이다(아래 logger 참조).
 * 🔴 이 서버를 공개 인터넷에 노출하지 않는다. 인증이 없고 CORS가 열려 있다 — localhost 전용이다.
 *
 * 실행:  npm run proxy          (.env의 OPENAI_API_KEY 사용 — 없으면 GEMINI_API_KEY)
 *        npm run proxy -- --provider gemini --port 8787
 *
 * 🔴 **provider 기본값은 배포본과 같아야 한다.** `functions/index.js`의 판정표가 미지정 요청을
 *    openai → gemini 순으로 고르므로 여기도 같은 순서다(2026-08-17 변경, 그전에는 gemini가
 *    먼저였다). 한쪽만 바꾸면 **"로컬에선 되는데 배포하면 다르다"**가 시작된다.
 */

import { createServer } from 'node:http';
import { refine, PROVIDERS, MemoryCacheStore as RefineCacheStore } from '../src/core/refine/index.js';
import { decode, MemoryCacheStore as DecodeCacheStore } from '../src/core/decode/index.js';
import {
  summarizeDecisions,
  MemoryCacheStore as DecisionsCacheStore,
} from '../src/core/decisions/index.js';
import { reply, MemoryCacheStore as ReplyCacheStore } from '../src/core/reply/index.js';
// 🔴 폴오버 사슬은 `src/core/refine/failover.js` 한 곳에만 있다 — Functions도 같은 파일을 쓴다
//    (sync-core가 복사한다). 두 서버에 표를 각각 적으면 어긋나고, 그 증상이
//    「로컬에선 되는데 배포하면 다르다」로 나온다.
import { remainingChain, sameStep, stepLabel } from '../src/core/refine/failover.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const port = Number(flag('--port', process.env.SAI_PROXY_PORT ?? 8787));
const providerName = flag('--provider', process.env.OPENAI_API_KEY ? 'openai' : 'gemini');
const model = flag('--model', undefined);

const provider = PROVIDERS[providerName];
if (!provider) {
  console.error(`알 수 없는 provider: ${providerName} (가능: ${Object.keys(PROVIDERS).join(', ')})`);
  process.exit(2);
}

const apiKey = process.env[provider.envKey];
if (!apiKey) {
  console.error(`${provider.envKey}가 없습니다. .env에 넣거나 환경변수로 주세요.`);
  console.error(`  node --env-file=.env server/refine-proxy.js --provider ${providerName}`);
  process.exit(2);
}

/**
 * **예비 provider** (2026-08-19 사용자 결정 ⓓ).
 *
 * 🔴 **왜 필요한가.** OpenAI 한도(TPM 10,000 · RPD 50)에 걸리면 지금은 화면에
 *    「교정하지 못했어요」가 뜨고 끝이다 — 시연 중이면 그대로 촬영이 멈춘다.
 *    다른 provider 키가 있는데도 쓰지 않는 것은 낭비다.
 *
 * 🔴 **한도(`quota`)일 때«만» 넘긴다.** 네트워크 오류·응답 형식 오류로는 넘기지 않는다 —
 *    그건 두 번 불러도 같은 이유로 실패하고, 조용한 이중 호출은 한도만 더 태운다.
 * 🔴 **사슬 끝까지** 내려간다 (2026-08-20). openai → gemini → openai/gpt-4.1.
 *    근거는 «한도가 모델별로 따로»라는 실측이다 — `src/core/refine/failover.js` 헤더 참조.
 *    사슬을 다 쓰고도 실패하면 원래대로 폴백 응답을 낸다.
 * 🔴 **어느 쪽이 답했는지 응답에 남긴다**(`providerUsed`) — 모델이 바뀌면 문체가 달라지는데
 *    그걸 모른 채 결과를 비교하면 "프롬프트를 고쳤더니 달라졌다"고 오진하게 된다.
 */
// 🔴 예전의 `backup`(예비 «하나») 상수는 지웠다 — 2026-08-20부터 예비가 사슬이라
//    `remainingChain()`이 그 역할을 대신한다. 남겨 두면 「예비는 한 개」라는 옛 모델이
//    코드에 계속 보인다.

/**
 * 프로세스 메모리 캐시를 공유한다 — 같은 문장 재시연이 공짜가 된다(Lessons #6).
 *
 * 🔴 **수명을 환경변수로 뺐다** (2026-08-19 — 시연 촬영 대비, 사용자 결정 ⓑ).
 *    기본 10분은 리허설 «한 번»을 겨우 덮는다. 촬영은 같은 문장을 몇 시간에 걸쳐 여러 번
 *    부르는데, 10분이 지나면 **매번 실호출**이 나가 OpenAI 하루 한도(RPD 50)를 갉아먹는다.
 *    `SAI_CACHE_TTL_MS`로 늘려 두면 그 시간 동안 **API 호출이 0건**이다.
 *
 * 🔴 **Zero Retention 경계는 그대로다** — 여전히 «프로세스 메모리 전용»이고 디스크·DB·로그
 *    어디에도 쓰지 않는다. 늘어나는 것은 「메모리에 남아 있는 시간」뿐이라, **상한 6시간**을
 *    둔다. 그보다 길게 잡고 싶은 상황이라면 캐시가 아니라 고정 응답을 쓰는 게 맞다.
 * 🔴 프록시를 껐다 켜면 캐시는 사라진다(메모리다) — 촬영 중에는 재시작하지 않는다.
 */
const CACHE_TTL_MAX_MS = 6 * 60 * 60 * 1000;
const cacheTtlMs = (() => {
  const raw = Number(process.env.SAI_CACHE_TTL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return undefined; // 기본값(10분)을 쓴다
  if (raw > CACHE_TTL_MAX_MS) {
    console.warn(`[cache] SAI_CACHE_TTL_MS가 상한(6시간)을 넘어 6시간으로 자릅니다.`);
    return CACHE_TTL_MAX_MS;
  }
  return raw;
})();

const refineCache = new RefineCacheStore({ ttlMs: cacheTtlMs });
const decodeCache = new DecodeCacheStore({ ttlMs: cacheTtlMs });
const decisionsCache = new DecisionsCacheStore({ ttlMs: cacheTtlMs });
const replyCache = new ReplyCacheStore({ ttlMs: cacheTtlMs });

/** 🔴 본문 없는 메타데이터만 찍는다 (Spec 필수 5). */
function logRefineEvent(event) {
  const parts = [
    `provider=${providerName}`,
    `urgency=${event.urgency ?? '-'}`,
    `intent=${event.detectedIntent ?? '-'}`,
    `cache=${event.cacheHit ? 'hit' : 'miss'}`,
    `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'}`,
    `${event.latencyMs ?? '-'}ms`,
  ];
  console.log(`[refine] ${parts.join(' ')}`);
}

function logDecodeEvent(event) {
  const parts = [
    `provider=${providerName}`,
    `surface=${event.surfaceUrgency ?? '-'}`,
    `actual=${event.actualUrgency ?? '-'}`,
    `gap=${event.urgencyGap ?? '-'}`,
    `cache=${event.cacheHit ? 'hit' : 'miss'}`,
    `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'}`,
    `${event.latencyMs ?? '-'}ms`,
  ];
  console.log(`[decode] ${parts.join(' ')}`);
}

/** 🔴 결정 문구·담당자 이름은 찍지 않는다 — 건수와 플래그뿐이다 (Spec 필수 5). */
function logDecisionsEvent(event) {
  const parts = [
    `provider=${providerName}`,
    `decisions=${event.decisionCount ?? '-'}`,
    `unresolved=${event.unresolvedCount ?? '-'}`,
    `unknownAuthority=${event.unknownAuthorityCount ?? '-'}`,
    `cache=${event.cacheHit ? 'hit' : 'miss'}`,
    `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'}`,
    `${event.latencyMs ?? '-'}ms`,
  ];
  console.log(`[decisions] ${parts.join(' ')}`);
}

/** 🔴 초안 본문은 찍지 않는다 — 의도 키와 길이 수치뿐이다 (Spec 필수 5). */
function logReplyEvent(event) {
  const parts = [
    `provider=${providerName}`,
    `intent=${event.intent ?? '-'}`,
    `len=${event.draftLength ?? '-'}`,
    `cache=${event.cacheHit ? 'hit' : 'miss'}`,
    `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'}`,
    `${event.latencyMs ?? '-'}ms`,
  ];
  console.log(`[reply] ${parts.join(' ')}`);
}

/**
 * `mode` 라우팅 표 — `functions/index.js`도 **같은 표**를 갖는다. 한쪽만 고치면 "로컬에선
 * 되는데 배포하면 다르다"가 시작되므로, 모드를 추가할 때는 반드시 두 파일을 함께 고친다.
 */
const MODES = {
  refine: {
    name: 'refine',
    run: (request, creds) =>
      refine(request, {
        ...creds,
        // 🔴 `creds.model`이 이기게 둔다 — 사슬 단계마다 모델이 다르다. 예전에는 `model`(CLI
        //    플래그)이 뒤에 와서 creds를 «덮었고», `--model gpt-4.1`로 띄운 채 한도에 걸리면
        //    **Gemini에게 openai 모델명을 넘겨** 그쪽에서 또 실패했다.
        model: creds.model ?? model,
        cache: refineCache,
        logger: logRefineEvent,
      }),
  },
  decode: {
    name: 'decode',
    run: (request, creds) =>
      decode(request, {
        ...creds,
        // 🔴 `creds.model`이 이기게 둔다 — 사슬 단계마다 모델이 다르다. 예전에는 `model`(CLI
        //    플래그)이 뒤에 와서 creds를 «덮었고», `--model gpt-4.1`로 띄운 채 한도에 걸리면
        //    **Gemini에게 openai 모델명을 넘겨** 그쪽에서 또 실패했다.
        model: creds.model ?? model,
        cache: decodeCache,
        logger: logDecodeEvent,
      }),
  },
  decisions: {
    name: 'decisions',
    run: (request, creds) =>
      summarizeDecisions(request, {
        ...creds,
        // 🔴 `creds.model`이 이기게 둔다 — 사슬 단계마다 모델이 다르다. 예전에는 `model`(CLI
        //    플래그)이 뒤에 와서 creds를 «덮었고», `--model gpt-4.1`로 띄운 채 한도에 걸리면
        //    **Gemini에게 openai 모델명을 넘겨** 그쪽에서 또 실패했다.
        model: creds.model ?? model,
        cache: decisionsCache,
        logger: logDecisionsEvent,
      }),
  },
  reply: {
    name: 'reply',
    run: (request, creds) =>
      reply(request, {
        ...creds,
        // 🔴 `creds.model`이 이기게 둔다 — 사슬 단계마다 모델이 다르다. 예전에는 `model`(CLI
        //    플래그)이 뒤에 와서 creds를 «덮었고», `--model gpt-4.1`로 띄운 채 한도에 걸리면
        //    **Gemini에게 openai 모델명을 넘겨** 그쪽에서 또 실패했다.
        model: creds.model ?? model,
        cache: replyCache,
        logger: logReplyEvent,
      }),
  },
};

/** 기본 provider 자격증명 — 모드 표는 이제 어느 provider로 부를지 «인자»로 받는다. */
const primaryCreds = { apiKey, provider: providerName };

/**
 * 한도에 걸렸을 때만 사슬의 다음 단계로 넘어간다 (2026-08-19 ⓓ → 2026-08-20 사슬로 확장).
 *
 * 🔴 **코어를 고치지 않았다.** 네 모드의 `refine/decode/decisions/reply`는 실패를 던지지 않고
 *    `{fallback: true, fallbackReason}` 응답으로 흡수한다 — 그 «결과»만 보고 판단하면
 *    모드별 내부를 건드리지 않고 네 개 모두에 한 번에 적용된다.
 * 🔴 `model` 플래그는 넘기지 않는다 — provider마다 모델 이름이 달라서, openai 모델명을
 *    gemini에 그대로 주면 그쪽에서 또 실패한다(각 provider의 기본 모델을 쓴다).
 */
function keyFor(providerId) {
  const entry = PROVIDERS[providerId];
  const value = entry && process.env[entry.envKey];
  return value ? { apiKey: value, provider: providerId } : null;
}

async function runWithFailover(mode, request) {
  const start = { provider: providerName, model: model ?? null };
  let used = start;
  let result = await mode.run(request, primaryCreds);

  for (const step of remainingChain(used)) {
    // 🔴 매 단계마다 다시 본다 — 중간 단계가 quota 아닌 이유로 실패하면 거기서 멈춘다.
    if (!result?.fallback || result.fallbackReason !== 'quota') break;

    const creds = keyFor(step.provider);
    if (!creds) continue; // 그 provider의 키가 없다 — 건너뛴다(멈추지 않는다)

    console.log(`[${mode.name}] ${stepLabel(used)} 한도 — ${stepLabel(step)}로 다시 시도합니다.`);
    result = await mode.run(request, { ...creds, model: step.model ?? undefined });
    used = { provider: step.provider, model: step.model ?? null };
  }

  if (sameStep(used, start)) return result;
  if (result?.fallback) {
    console.log(`[${mode.name}] ${stepLabel(used)}도 실패(${result.fallbackReason}) — 폴백 응답을 냅니다.`);
    return result;
  }
  return { ...result, providerUsed: used.provider, modelUsed: used.model };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // 개발 전용 — 확장(chrome-extension://…)과 하네스(localhost:4175)가 서로 다른 오리진이다.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      // 상한 — 무한정 받아 메모리를 채우지 않는다.
      if (size > 256 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, provider: providerName, model: model ?? provider.defaultModel });
    return;
  }

  if (req.method !== 'POST' || !req.url.startsWith('/v1/refine')) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  let request;
  try {
    request = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: 'invalid json' });
    return;
  }

  /**
   * 🔴 `if (isDecode)` 이분기에서 **모드 표**로 바꿨다 (S25). 모드가 셋이 되는 순간 삼항 중첩은
   *    읽기 어렵고, 무엇보다 `functions/index.js`가 같은 규칙을 따로 적어 두고 있어 한쪽만
   *    고치는 사고가 난다 — 표로 두면 두 파일의 차이가 눈에 보인다.
   */
  const mode = MODES[request?.mode] ?? MODES.refine;
  try {
    sendJson(res, 200, await runWithFailover(mode, request));
  } catch (error) {
    // 🔴 에러 메시지에 본문이 섞이지 않게 우리 문구만 내보낸다.
    console.error(`[${mode.name}] 요청 거절: ${error?.name ?? 'error'}`);
    sendJson(res, 400, { error: error?.message ?? 'bad request' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`사이 refine 프록시 — http://127.0.0.1:${port}`);
  console.log(`  provider=${providerName}  model=${model ?? provider.defaultModel}`);
  /**
   * 🔴 **키가 없는 단계는 빼고 찍는다.** 부팅 로그가 「gpt-4.1까지 간다」고 말해 놓고 실제로는
   *    키가 없어 건너뛰면, 촬영 중에 왜 멈췄는지 알 수 없다.
   */
  const chain = [
    stepLabel({ provider: providerName, model }),
    ...remainingChain({ provider: providerName, model: model ?? null })
      .filter((step) => keyFor(step.provider))
      .map(stepLabel),
  ];
  console.log(`  폴오버 사슬=${chain.join(' → ')} (한도일 때만 다음으로 넘어감)`);
  console.log(`  캐시 수명=${(cacheTtlMs ?? 10 * 60 * 1000) / 60000}분`);
  console.log(`  POST /v1/refine · GET /health`);
  console.log('  🔴 localhost 전용 — 인증이 없으므로 외부에 노출하지 마세요.');
});
