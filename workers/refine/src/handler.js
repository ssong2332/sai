/**
 * Worker 요청 처리 — `functions/index.js` `refineV1`을 옮긴 1단계 시험판(L33). 네 mode(refine·decode·decisions·reply)를
 * 모두 처리한다(2026-10-24 — 그전에는 refine만, 나머지는 501).
 *
 * 🔴 이 파일은 **얇은 껍데기**다. 프롬프트·판정·캐시·폴백·**폴오버 사슬**은 공유 코어 `src/core/{refine,decode,decisions,reply}/`를
 *    **복사 없이 직접** 부른다(wrangler/esbuild가 번들한다). `functions/`처럼 sync-core 복사본을 두지 않는다 —
 *    복사본이 하나 더 생기면 갈라질 곳이 하나 더 생긴다.
 *
 * 라우팅 표
 * | 메서드·경로 | 처리 |
 * |---|---|
 * | `OPTIONS *` | CORS 사전 요청 — `cors.js` 판정표 |
 * | `GET /health` | 설정 상태(키 **이름·유무**만, 값 없음) |
 * | `POST /v1/refine` + `mode` 없음·`refine`·모르는 값 | 교정 `refine()` — 기존 서버와 같이 모르는 mode는 refine으로 본다 |
 * | `POST /v1/refine` + `mode` = `decode` | 수신 해독 `decode()` |
 * | `POST /v1/refine` + `mode` = `decisions` | 결정 요약 `summarizeDecisions()` |
 * | `POST /v1/refine` + `mode` = `reply` | 회신 초안 `reply()` |
 * | `/v1/refine` 그 밖 메서드 | 405 `{error:'method not allowed'}` (기존과 같다) |
 * | 그 밖 경로 | 404 |
 *
 * 요청 처리 순서 (기존 refineV1과 같은 순서 — 🔴 차이는 ①만)
 * ① Origin 판정(다른 오리진 403) → 설정 누락 500 → 토큰 401 `{error:'unauthorized', reason}` → 본문 JSON(깨지면 400)
 * → 일일 상한 429 — `usageStore.js` 표(시크릿 없으면 스텁 — 항상 통과)
 * → provider 판정(아래 표) → mode 코어(위 표) + 폴오버 → 던지면 400 `{error: message}` → 지표 기록(mode별) → 200
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
import { decode } from '../../../src/core/decode/index.js';
import { summarizeDecisions } from '../../../src/core/decisions/index.js';
import { reply } from '../../../src/core/reply/index.js';
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
import { handleTeam } from './teamRoute.js';
import { resolveQuality, qualityStepDeps } from '../../../src/core/refine/quality.js';
import { googleClientsFromEnv } from './google/clients.js';
import { PLAN_LIMITS, handleBilling, readBillingConfig, resolvePlan } from './billing.js';

/**
 * 🔴 `mode` 라우팅 표 — `functions/index.js` `MODES`와 **같은 코어·같은 로그 필드**다(2026-10-24 이식).
 *    차이는 하나: 여기서는 **폴백일 때만** 로그를 쓴다(아래 `runStep` 주석 — 무료 플랜 CPU 한도).
 *    모드를 추가할 때는 Functions·프록시와 함께 고친다. 표에 없는 mode는 refine으로 본다(기존과 같다).
 * 🔴 로그 필드는 건수·키·플래그뿐이다 — 결정 문구·담당자 이름·초안 본문은 싣지 않는다(Spec 필수 5).
 * | mode | 코어 | 폴백 로그에 남는 값 |
 * |---|---|---|
 * | `refine` | `refine()` | 긴급도·의도·캐시·사유·시간 |
 * | `decode` | `decode()` | 표면/실제 긴급도·격차·캐시·사유·시간 |
 * | `decisions` | `summarizeDecisions()` | 결정/미결/권한 불명 건수·캐시·사유·시간 |
 * | `reply` | `reply()` | 의도 키·초안 길이·캐시·사유·시간 |
 */
const MODES = {
  refine: {
    run: refine,
    describe: (event) => `urgency=${event.urgency ?? '-'} intent=${event.detectedIntent ?? '-'}`,
  },
  decode: {
    run: decode,
    describe: (event) =>
      `surface=${event.surfaceUrgency ?? '-'} actual=${event.actualUrgency ?? '-'} gap=${event.urgencyGap ?? '-'}`,
  },
  decisions: {
    run: summarizeDecisions,
    describe: (event) =>
      `decisions=${event.decisionCount ?? '-'} unresolved=${event.unresolvedCount ?? '-'} ` +
      `unknownAuthority=${event.unknownAuthorityCount ?? '-'}`,
  },
  reply: {
    run: reply,
    describe: (event) => `intent=${event.intent ?? '-'} len=${event.draftLength ?? '-'}`,
  },
};

/** 표에 있는 mode면 그 이름, 아니면 `refine`(모르는 값·없음 포함 — 기존 서버와 같다). */
export function resolveMode(mode) {
  return typeof mode === 'string' && Object.hasOwn(MODES, mode) ? mode : 'refine';
}

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
 * @param {object|((env: object) => object)} [deps.usageStore] `usageStore.js` 인터페이스, 또는 env를 받아 그것을 돌려주는 함수
 *   (운영 `index.js` = `usageStoreFromEnv` — 시크릿은 요청의 env로만 온다).
 * @param {typeof fetch} [deps.fetchImpl] provider 호출에 넘길 fetch(테스트는 가짜 응답 — 모든 provider 공용).
 * @param {object} [deps.cache] refine 코어 캐시 스토어.
 * @param {{decode?: object, decisions?: object, reply?: object}} [deps.caches] 나머지 mode의 캐시 스토어.
 * @param {(env: object) => object|null} [deps.google] env → Google 클라이언트(`google/clients.js`). 테스트는 가짜 Firestore를 넘긴다.
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
    caches = {},
    now = () => Date.now(),
    logger = console,
    google = (env) => googleClientsFromEnv(env),
  } = deps;
  // mode마다 스토어 하나 — Functions(`refineCache`·`decodeCache`·…)와 같다. 같은 isolate 메모리 전용 클래스다.
  const modeCaches = {
    refine: cache,
    decode: caches.decode ?? new MemoryCacheStore(),
    decisions: caches.decisions ?? new MemoryCacheStore(),
    reply: caches.reply ?? new MemoryCacheStore(),
  };

  const storeFor = typeof usageStore === 'function' ? usageStore : () => usageStore;

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
        usageStore: safeStoreKind(storeFor, env, logger),
        // 팀 API(/v1/team) — 서비스 계정 시크릿이 있어야 ready.
        team: safeGoogle(google, env, logger) ? 'ready' : 'unavailable',
        // 결제(/v1/billing/*, 2026-10-31) — 값은 싣지 않고 준비 여부·모드만.
        billing: billingStatus(readBillingConfig(env)),
      });
    }

    // 팀 API — 판정은 functions/*.js 그대로(teamRoute.js 헤더). 설정 누락은 교정과 같게 500.
    if (url.pathname === '/v1/team') {
      if (config.missing.length > 0) {
        logger.error(`[team] 설정 누락: ${config.missing.join(',')}`);
        return json(500, { error: 'server misconfigured' });
      }
      return handleTeam(request, { config, google: safeGoogle(google, env, logger), json, logger, jwks, now, env });
    }

    // 결제 — `billing.js` 헤더. 웹훅은 Paddle 서버가 부른다(Origin 없음 → 위 판정에서 통과).
    if (url.pathname.startsWith('/v1/billing/')) {
      return handleBilling(request, {
        config,
        billing: readBillingConfig(env),
        db: safeGoogle(google, env, logger)?.db ?? null,
        json,
        logger,
        jwks,
        now,
        ...(fetchImpl ? { fetchImpl } : {}),
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

    // ⑤ mode — 위 `MODES` 표. 모르는 값은 refine(2026-10-24부터 501 없음).
    const modeName = resolveMode(body.mode);
    const mode = MODES[modeName];

    // 🔴 2026-10-30 품질 모드 — 다듬기(refine)만. 확장은 이름만 보내고 모델·사고·effort는 `quality.js` 표가 정한다.
    //    모르는 값·없음은 기본값(빠른). 2026-10-31부터 아래 ⑥이 상위 모드를 빠른으로 낮출 수 있다(`qualityAllowance.js`).
    let quality = modeName === 'refine' ? resolveQuality(body.quality) : null;
    let downgrade = null;

    // ⑥ 일일 상한 + 품질 모드 허용량 — 기존과 같이 **카운터 장애로 교정을 멈추지 않는다**(저장소를 못 만들어도 noop으로 통과).
    const store = resolveStore(storeFor, env, logger);
    try {
      // 2026-10-31 요금제별 한도 — 구독 문서가 없거나 못 읽으면 `beta`/`free`(`BILLING_ENFORCED`) 판정표 그대로.
      let plan = 'beta';
      try {
        const billingDoc = store.getBilling ? await store.getBilling(uid) : null;
        plan = resolvePlan(billingDoc, readBillingConfig(env));
      } catch (error) {
        plan = resolvePlan(null, readBillingConfig(env));
        logger.error(`[billing] 구독 확인 실패 — ${plan}로 처리: ${error?.code ?? error?.name ?? 'unknown'}`);
      }
      // 🔴 `beta`(유료 출시 전 무료)는 한도를 넘기지 않는다 — 저장소의 원래 상한(`DAILY_REFINE_LIMIT`)·기본 표 그대로(P5).
      const limits = plan === 'beta' ? null : PLAN_LIMITS[plan];
      const quota = store.admit ? await store.admit(uid, { quality, limits }) : await store.consumeDailyQuota(uid);
      if (!quota.ok) {
        logger.warn(`[refine] 일일 상한 초과 used=${quota.used} limit=${quota.limit}`);
        return json(429, { error: 'daily-limit', limit: quota.limit });
      }
      if (quota.downgrade) {
        quality = quota.quality;
        downgrade = quota.downgrade;
        // 🔴 사유 코드만 — uid·본문 없음.
        logger.log(`[refine] 품질 모드 낮춤 → ${quality} reason=${downgrade}`);
      }
      if (quota.used === 1) await safeMetric(logger, () => store.recordDailyUser(uid));
    } catch (error) {
      logger.error(`[refine] 상한 확인 실패 — 통과시킴: ${error?.code ?? error?.name ?? 'unknown'}`);
      // 🔴 셀 수 없을 때 비싼 모드를 열어 두지 않는다 — 다듬기는 빠른 모드로(안전한 쪽, 2026-10-31).
      if (quality && quality !== 'fast') {
        quality = 'fast';
        downgrade = 'unavailable';
      }
    }

    // ⑦ provider — 위 판정표. 명시 요청은 대체하지 않는다.
    const selected = resolveProvider(body.provider, config.keys);
    if (!selected) {
      logger.error('[refine] 사용할 수 있는 provider 키가 없습니다 — wrangler secret put ANTHROPIC_API_KEY / GROQ_API_KEY 필요');
      return json(500, { error: 'no provider configured' });
    }

    const thinking = thinkingSwitch(config.thinking);
    // 사슬 단계 모델(stepModel)이 있으면 그 단계는 품질 모드 표를 쓰지 않는다.

    /** 한 단계 호출. 🔴 `ANTHROPIC_MODEL`은 anthropic 단계에만 — 사슬 단계 모델이 있으면 그게 이긴다. */
    const runStep = ({ provider, apiKey }, stepModel) => {
      const model = stepModel ?? (provider === 'anthropic' ? config.anthropicModel : undefined);
      const q = quality && !stepModel ? qualityStepDeps(quality, provider) : {};
      return mode.run(body, {
        apiKey,
        provider,
        model,
        cache: modeCaches[modeName],
        // 🔴 네 코어 모두 이 값을 provider에 그대로 넘긴다 — Worker 요청 경로가 `process`를 건드리지 않게.
        thinking,
        // 품질 모드 표 값이 있으면 위 model·thinking보다 이긴다(anthropic 단계만 — `qualityStepDeps`).
        ...q,
        ...(fetchImpl ? { fetchImpl } : {}),
        now,
        // 🔴 성공(폴백 아님) 이벤트는 로그를 쓰지 않는다 (2026-10-24 L33). 무료 플랜 CPU 한도 10ms에 실측 콜드 22ms —
        //    로컬 workerd에서 console.log 한 줄이 첫 요청 +10ms·데운 요청 +3ms였다. 성공 건수·지연은 Cloudflare
        //    자체 요청 지표로 본다. 폴백일 때만 남긴다(사유 진단용). 폴오버·warn·error 로그는 그대로다.
        logger: (event) => {
          if (!event.fallback) return;
          logger.log(
            `[${modeName}] provider=${stepLabel({ provider, model })} ${mode.describe(event)} ` +
              `cache=${event.cacheHit ? 'hit' : 'miss'} fallback=${event.fallbackReason ?? 'yes'} ${event.latencyMs}ms`,
          );
        },
      });
    };

    // ⑧ 코어 + 폴오버 — `functions/index.js` `runWithFailover`와 같은 흐름(네 mode 공통 — 결과의 사유만 본다).
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
          logger.log(`[${modeName}] ${stepLabel(used)} ${result.fallbackReason} — ${stepLabel(step)}로 다시 시도합니다.`);
          result = await runStep({ provider: step.provider, apiKey }, step.model ?? undefined);
          used = { provider: step.provider, model: step.model ?? null };
        }
      }
      if (!sameStep(used, start)) {
        if (result?.fallback) {
          logger.log(`[${modeName}] ${stepLabel(used)}도 실패(${result.fallbackReason}) — 폴백을 냅니다.`);
        } else {
          result = { ...result, providerUsed: used.provider, modelUsed: used.model };
        }
      }
    } catch (error) {
      // 🔴 코어의 *RequestError 문구는 우리 문구다(본문 없음). 그 밖 오류는 이름만 로그에.
      logger.error(`[${modeName}] 요청 거절: ${error?.name ?? 'error'}`);
      await safeMetric(logger, () =>
        store.recordRequest({ mode: modeName, rejected: true, latencyMs: now() - receivedAt }),
      );
      return json(400, { error: error?.message ?? 'bad request' });
    }

    // 다듬기 응답에 실제로 쓴 품질 모드 이름을 붙인다(화면 표시용 — 모델명은 싣지 않는다).
    // 낮췄으면 사유도 붙인다(`budget`·`daily`·`unavailable` — 팝업 문구용).
    if (quality && result && typeof result === 'object') {
      result = { ...result, quality, ...(downgrade ? { qualityDowngrade: downgrade } : {}) };
    }

    // ⑨ 지표 — 모드·성공 여부·사유 코드·시간뿐.
    await safeMetric(logger, () =>
      store.recordRequest({
        mode: modeName,
        fallback: result?.fallback === true,
        fallbackReason: result?.fallbackReason,
        latencyMs: now() - receivedAt,
      }),
    );
    return json(200, result);
  };
}

/** `/health`용 — 값 없이 준비 여부만. */
function billingStatus(billing) {
  if (!billing.checkoutReady && !billing.webhookReady) return 'unavailable';
  return { checkout: billing.checkoutReady, webhook: billing.webhookReady, enforced: billing.enforced };
}

/** env → 저장소. 만들다 실패하면(시크릿 형식·프로젝트 불일치) noop — 로그에는 사유 코드만. */
function resolveStore(storeFor, env, logger) {
  try {
    return storeFor(env);
  } catch (error) {
    logger.error(`[usage] 저장소 준비 실패 — 상한 없이 통과: ${error?.code ?? error?.name ?? 'unknown'}`);
    return createNoopUsageStore();
  }
}

/** env → Google 클라이언트. 못 만들면 null(사유 코드만 로그) — 팀 API는 503으로 드러난다. */
function safeGoogle(google, env, logger) {
  try {
    return google(env);
  } catch (error) {
    logger.error(`[google] 준비 실패: ${error?.code ?? error?.name ?? 'unknown'}`);
    return null;
  }
}

function safeStoreKind(storeFor, env, logger) {
  return resolveStore(storeFor, env, logger).kind ?? 'custom';
}

/** 지표 실패가 교정을 막지 않는다(L20). 로그에는 오류 코드만. */
async function safeMetric(logger, write) {
  try {
    await write();
  } catch (error) {
    logger.error(`[metrics] 기록 실패: ${error?.code ?? error?.name ?? 'unknown'}`);
  }
}
