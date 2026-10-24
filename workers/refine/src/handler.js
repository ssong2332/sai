/**
 * Worker 요청 처리 — `functions/index.js` `refineV1`의 **refine 모드만** 옮긴 1단계 시험판(L33).
 *
 * 🔴 이 파일은 **얇은 껍데기**다. 프롬프트·판정·캐시·폴백·**폴오버 사슬**은 공유 코어 `src/core/refine/`를
 *    **복사 없이 직접** 부른다(wrangler/esbuild가 번들한다). `functions/`처럼 sync-core 복사본을 두지 않는다 —
 *    복사본이 하나 더 생기면 갈라질 곳이 하나 더 생긴다.
 *
 * 라우팅 표
 * | 메서드·경로 | 처리 |
 * |---|---|
 * | `OPTIONS *` | CORS 사전 요청 — `cors.js` 판정표 |
 * | `GET /health` | 설정 상태(키 **이름·유무**만, 값 없음) |
 * | `POST /v1/refine` + `mode` 없음·`refine`·모르는 값 | 교정 — 기존 서버와 같이 모르는 mode는 refine으로 본다 |
 * | `POST /v1/refine` + `mode` = `decode`·`decisions`·`reply` | **501** `{error:'not implemented', mode}` — 🔴 1단계 범위 밖(LLM·상한 안 씀) |
 * | `/v1/refine` 그 밖 메서드 | 405 `{error:'method not allowed'}` (기존과 같다) |
 * | 그 밖 경로 | 404 |
 *
 * 요청 처리 순서 (기존 refineV1과 같은 순서 — 🔴 차이는 ①·⑤만)
 * ① Origin 판정(다른 오리진 403) → 설정 누락 500 → 토큰 401 `{error:'unauthorized', reason}` → 본문 JSON(깨지면 400)
 * → ⑤ 1단계 미지원 mode 501(상한을 쓰기 전에 끊는다) → 일일 상한 429 — 🔴 1단계는 스텁(`usageStore.js`)이라 항상 통과
 * → provider 판정(아래 표) → 코어 `refine()` + 폴오버 → 던지면 400 `{error: message}` → 지표 기록 → 200
 *
 * provider 판정표 (2026-10-23 — `functions/index.js` `resolveProviderAndKey`와 같은 규칙, 임시 기본만 없다)
 * | `body.provider` | 그 provider 키 | 사슬 키(ANTHROPIC → GROQ 순) | 선택 |
 * |---|---|---|---|
 * | 알려진 이름(`PROVIDERS`) | 있음 | — | 그 provider (폴오버 없음) |
 * | 알려진 이름 | 없음 | — | **500** `no provider configured` (대체하지 않는다) |
 * | 미지정·기타 | — | 있는 첫 provider | 그 provider ← Spec §0 기본(Claude) |
 * | 미지정·기타 | — | 없음 | **500** `no provider configured` |
 * 🔴 Functions의 「임시 기본 gemini」는 여기 없다 — Worker는 새로 배포하는 것이라 지켜야 할 운영 동작이 없고,
 *    Gemini 무료 티어는 입력을 학습에 쓴다(사용자 결정 (b)). 시크릿을 넣지 않고 배포하면 500으로 드러난다.
 *
 * 폴오버 (2026-10-23 — 같은 날 1단계는 「폴오버 없음, Claude 하나」였다)
 * 🔴 판정·사슬은 `failover.js`의 `shouldFailOver`·`remainingChain`·`pickDefaultProvider`만 쓴다 — 표를 여기 다시
 *    적지 않는다(`test/failover.unit.test.js`가 잠근다). 조건: ① 사유 quota·auth만 ② 명시 요청은 넘기지 않는다
 *    ③ 키 없는 단계는 건너뛴다 ④ 사슬 끝까지. 다른 단계가 답하면 `providerUsed`·`modelUsed`를 붙인다(Functions와 같다).
 * 🔴 Zero Retention (Spec 필수 5): 로그에는 provider·긴급도·의도·캐시·폴백 사유·시간만. 요청 본문·교정문·
 *    토큰·키는 어떤 로그에도 쓰지 않는다 — `test/handler.test.js` 「로그에 본문 없음」이 잠근다.
 */

import { refine, MemoryCacheStore, PROVIDERS } from '../../../src/core/refine/index.js';
import {
  DEFAULT_PROVIDER_ORDER,
  pickDefaultProvider,
  remainingChain,
  sameStep,
  shouldFailOver,
  stepLabel,
} from '../../../src/core/refine/failover.js';
import { readConfig } from './config.js';
import { AuthError, bearerToken, verifyFirebaseIdToken } from './auth.js';
import { corsHeaders, judgeOrigin } from './cors.js';
import { createNoopUsageStore } from './usageStore.js';

const NOT_IMPLEMENTED_MODES = new Set(['decode', 'decisions', 'reply']);

/**
 * 🔴 사고(thinking) 스위치 — 코어 `refine()`에 **값으로 넘긴다**(`deps.thinking`, 2026-10-24 L33).
 *    이전에는 `env` 값을 `process.env`에 옮겼는데(`applyThinkingSwitch`), 요청 중 `globalThis.process` 첫 접근이
 *    Node 호환 내부를 늦게 불러 콜드 요청에 +3ms(로컬 workerd 실측)였다. 이제 요청 경로는 `process`를 건드리지 않는다
 *    (`test/handler.test.js`가 잠근다). 🔴 값은 **항상 명시**한다 — `undefined`면 코어가 `process.env`로 내려간다.
 * | `SAI_ANTHROPIC_THINKING`(env) | 넘기는 값 |
 * |---|---|
 * | `adaptive` | `'adaptive'`(켬 — 실험 전용) |
 * | 없음 · 그 밖의 값 | `'disabled'`(끔 — 기본, 오타도 끔) |
 */
export function thinkingSwitch(value) {
  return value === 'adaptive' ? 'adaptive' : 'disabled';
}

/** 위 판정표. @returns {{provider: string, apiKey: string} | null} */
export function resolveProvider(requested, keys) {
  if (typeof requested === 'string' && Object.hasOwn(PROVIDERS, requested)) {
    return keys[requested] ? { provider: requested, apiKey: keys[requested] } : null;
  }
  const provider = pickDefaultProvider((name) => Boolean(keys[name]));
  return provider ? { provider, apiKey: keys[provider] } : null;
}

/**
 * @param {object} [deps] 전부 테스트 주입용. 운영 기본값은 `index.js`.
 * @param {Function} [deps.jwks] jose 키 묶음(테스트는 `createLocalJWKSet`).
 * @param {object} [deps.usageStore] `usageStore.js` 인터페이스.
 * @param {typeof fetch} [deps.fetchImpl] provider 호출에 넘길 fetch(테스트는 가짜 응답 — 모든 provider 공용).
 * @param {object} [deps.cache] 코어 캐시 스토어.
 * @param {() => number} [deps.now]
 * @param {{log: Function, warn: Function, error: Function}} [deps.logger] 기본 console.
 */
export function createHandler(deps = {}) {
  const {
    jwks,
    usageStore = createNoopUsageStore(),
    fetchImpl,
    // 🔴 isolate 메모리 전용(Zero Retention 경계 — 코어 cache.js와 같다). isolate가 여러 개라 적중률은 낮다.
    cache = new MemoryCacheStore(),
    now = () => Date.now(),
    logger = console,
  } = deps;

  return async function handle(request, env = {}) {
    const config = readConfig(env);
    const url = new URL(request.url);
    const origin = judgeOrigin(request, config.extensionId);

    const json = (status, body) =>
      new globalThis.Response(JSON.stringify(body), {
        status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...(origin === 'allowed' ? corsHeaders(config.extensionId) : {}),
        },
      });

    if (origin === 'rejected') {
      logger.warn('[cors] 허용되지 않은 오리진 — 거절');
      return new globalThis.Response(JSON.stringify({ error: 'origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (request.method === 'OPTIONS') {
      return new globalThis.Response(null, {
        status: 204,
        headers: origin === 'allowed' ? corsHeaders(config.extensionId) : {},
      });
    }

    if (url.pathname === '/health') {
      if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
      const selected = resolveProvider(undefined, config.keys);
      // 🔴 키 값은 절대 내보내지 않는다 — 이름·유무만. 순서: 사슬 → 사슬 밖(명시 요청용).
      const order = [...DEFAULT_PROVIDER_ORDER, ...Object.keys(PROVIDERS).filter((n) => !DEFAULT_PROVIDER_ORDER.includes(n))];
      return json(200, {
        ok: true,
        runtime: 'cloudflare-workers',
        stage: 1,
        provider: selected?.provider ?? null,
        availableProviders: order.filter((name) => Boolean(config.keys[name])),
        failoverChain: remainingChain({ provider: null }).map(stepLabel),
        configured: selected !== null && config.missing.length === 0,
        missingConfig: config.missing,
        model: config.anthropicModel ?? null,
        // 코어 판정표와 같게 — `adaptive`만 켬, 나머지(없음 포함)는 끔.
        thinking: thinkingSwitch(config.thinking),
        usageStore: usageStore.kind ?? 'custom',
      });
    }

    if (url.pathname !== '/v1/refine') return json(404, { error: 'not found' });
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

    const receivedAt = now();

    if (config.missing.length > 0) {
      logger.error(`[refine] 설정 누락: ${config.missing.join(',')}`);
      return json(500, { error: 'server misconfigured' });
    }

    // ③ 인증 — 🔴 목업으로 대신 통과하지 않는다(기존 refineV1 주석과 같다). 확장은 401을 보고 로그인을 띄운다.
    let uid;
    try {
      ({ uid } = await verifyFirebaseIdToken(bearerToken(request), {
        projectId: config.projectId,
        ...(jwks ? { jwks } : {}),
        now,
      }));
    } catch (error) {
      const reason = error instanceof AuthError ? error.reason : 'bad-token';
      // 🔴 jose 오류 코드만(예: ERR_JWT_EXPIRED) — 토큰 문자열·클레임은 남기지 않는다.
      logger.warn(`[refine] 인증 거절 reason=${reason} code=${error?.code ?? '-'}`);
      return json(401, { error: 'unauthorized', reason });
    }

    // ④ 본문
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'bad request' });
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad request' });

    // ⑤ 1단계 범위 밖 mode — 상한·LLM을 쓰기 전에 끊는다.
    if (NOT_IMPLEMENTED_MODES.has(body.mode)) {
      return json(501, { error: 'not implemented', mode: body.mode });
    }

    // ⑥ 일일 상한 — 🔴 1단계 스텁. 기존과 같이 **카운터 장애로 교정을 멈추지 않는다**.
    try {
      const quota = await usageStore.consumeDailyQuota(uid);
      if (!quota.ok) {
        logger.warn(`[refine] 일일 상한 초과 used=${quota.used} limit=${quota.limit}`);
        return json(429, { error: 'daily-limit', limit: quota.limit });
      }
      if (quota.used === 1) await safeMetric(logger, () => usageStore.recordDailyUser(uid));
    } catch (error) {
      logger.error(`[refine] 상한 확인 실패 — 통과시킴: ${error?.code ?? error?.name ?? 'unknown'}`);
    }

    // ⑦ provider — 위 판정표. 명시 요청은 대체하지 않는다.
    const selected = resolveProvider(body.provider, config.keys);
    if (!selected) {
      logger.error('[refine] 사용할 수 있는 provider 키가 없습니다 — wrangler secret put ANTHROPIC_API_KEY / GROQ_API_KEY 필요');
      return json(500, { error: 'no provider configured' });
    }

    const thinking = thinkingSwitch(config.thinking);

    /** 한 단계 호출. 🔴 `ANTHROPIC_MODEL`은 anthropic 단계에만 — 사슬 단계 모델이 있으면 그게 이긴다. */
    const runStep = ({ provider, apiKey }, stepModel) => {
      const model = stepModel ?? (provider === 'anthropic' ? config.anthropicModel : undefined);
      return refine(body, {
        apiKey,
        provider,
        model,
        cache,
        thinking,
        ...(fetchImpl ? { fetchImpl } : {}),
        now,
        // 🔴 성공(폴백 아님) 이벤트는 로그를 쓰지 않는다 (2026-10-24 L33). 무료 플랜 CPU 한도 10ms에 실측 콜드 22ms —
        //    로컬 workerd에서 console.log 한 줄이 첫 요청 +10ms·데운 요청 +3ms였다. 성공 건수·지연은 Cloudflare
        //    자체 요청 지표로 본다. 폴백일 때만 남긴다(사유 진단용). 폴오버·warn·error 로그는 그대로다.
        logger: (event) => {
          if (!event.fallback) return;
          logger.log(
            `[refine] provider=${stepLabel({ provider, model })} urgency=${event.urgency ?? '-'} ` +
              `intent=${event.detectedIntent ?? '-'} cache=${event.cacheHit ? 'hit' : 'miss'} ` +
              `fallback=${event.fallbackReason ?? 'yes'} ${event.latencyMs}ms`,
          );
        },
      });
    };

    // ⑧ 코어 + 폴오버 — `functions/index.js` `runWithFailover`와 같은 흐름.
    let result;
    try {
      const start = { provider: selected.provider, model: null };
      let used = start;
      result = await runStep(selected);
      if (!body.provider) {
        for (const step of remainingChain(used)) {
          // 🔴 매 단계 다시 본다 — 중간 단계가 quota·auth 아닌 이유로 실패하면 거기서 멈춘다.
          if (!shouldFailOver(result)) break;
          const apiKey = config.keys[step.provider];
          if (!apiKey) continue; // 그 provider의 키가 없다 — 건너뛴다(멈추지 않는다)
          logger.log(`[refine] ${stepLabel(used)} ${result.fallbackReason} — ${stepLabel(step)}로 다시 시도합니다.`);
          result = await runStep({ provider: step.provider, apiKey }, step.model ?? undefined);
          used = { provider: step.provider, model: step.model ?? null };
        }
      }
      if (!sameStep(used, start)) {
        if (result?.fallback) {
          logger.log(`[refine] ${stepLabel(used)}도 실패(${result.fallbackReason}) — 폴백을 냅니다.`);
        } else {
          result = { ...result, providerUsed: used.provider, modelUsed: used.model };
        }
      }
    } catch (error) {
      // 🔴 코어의 RefineRequestError 문구는 우리 문구다(본문 없음). 그 밖 오류는 이름만 로그에.
      logger.error(`[refine] 요청 거절: ${error?.name ?? 'error'}`);
      await safeMetric(logger, () =>
        usageStore.recordRequest({ mode: 'refine', rejected: true, latencyMs: now() - receivedAt }),
      );
      return json(400, { error: error?.message ?? 'bad request' });
    }

    // ⑨ 지표 — 모드·성공 여부·사유 코드·시간뿐.
    await safeMetric(logger, () =>
      usageStore.recordRequest({
        mode: 'refine',
        fallback: result?.fallback === true,
        fallbackReason: result?.fallbackReason,
        latencyMs: now() - receivedAt,
      }),
    );
    return json(200, result);
  };
}

/** 지표 실패가 교정을 막지 않는다(L20). 로그에는 오류 코드만. */
async function safeMetric(logger, write) {
  try {
    await write();
  } catch (error) {
    logger.error(`[metrics] 기록 실패: ${error?.code ?? error?.name ?? 'unknown'}`);
  }
}
