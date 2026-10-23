/**
 * Worker ?붿껌 泥섎━ ??`functions/index.js` `refineV1`??**refine 紐⑤뱶留?* ??릿 1?④퀎 ?쒗뿕??L33).
 *
 * ?뵶 ???뚯씪??**?뉗? 猿띾뜲湲?*?? ?꾨＼?꾪듃쨌?먯젙쨌罹먯떆쨌?대갚? 怨듭쑀 肄붿뼱 `src/core/refine/`瑜?**蹂듭궗 ?놁씠 吏곸젒**
 *    遺瑜몃떎(wrangler/esbuild媛 踰덈뱾?쒕떎). `functions/`泥섎읆 sync-core 蹂듭궗蹂몄쓣 ?먯? ?딅뒗????蹂듭궗蹂몄씠 ?섎굹
 *    ???앷린硫?媛덈씪吏?怨녹씠 ?섎굹 ???앷릿??
 *
 * ?쇱슦???? * | 硫붿꽌?쑣룰꼍濡?| 泥섎━ |
 * |---|---|
 * | `OPTIONS *` | CORS ?ъ쟾 ?붿껌 ??`cors.js` ?먯젙??|
 * | `GET /health` | ?ㅼ젙 ?곹깭(??**?대쫫쨌?좊Т**留? 媛??놁쓬) |
 * | `POST /v1/refine` + `mode` ?놁쓬쨌`refine`쨌紐⑤Ⅴ??媛?| 援먯젙 ??湲곗〈 ?쒕쾭? 媛숈씠 紐⑤Ⅴ??mode??refine?쇰줈 蹂몃떎 |
 * | `POST /v1/refine` + `mode` = `decode`쨌`decisions`쨌`reply` | **501** `{error:'not implemented', mode}` ???뵶 1?④퀎 踰붿쐞 諛? LLM쨌?곹븳 ??? |
 * | `/v1/refine` 洹?諛?硫붿꽌??| 405 `{error:'method not allowed'}` (湲곗〈怨?媛숇떎) |
 * | 洹?諛?寃쎈줈 | 404 |
 *
 * ?붿껌 泥섎━ ?쒖꽌 (湲곗〈 refineV1怨?媛숈? ?쒖꽌 ???뵶 李⑥씠???ㅒ룐뫁留?
 * ??Origin ?먯젙(?ㅻⅨ ?ㅻ━吏?403) ???ㅼ젙 ?꾨씫 500 ???좏겙 401 `{error:'unauthorized', reason}` ??蹂몃Ц JSON(源⑥?硫?400)
 * ??1?④퀎 誘몄???mode 501(?곹븳???곌린 ?꾩뿉 ?딅뒗?? ???쇱씪 ?곹븳 429 ???뵶 1?④퀎???ㅽ뀅(`usageStore.js`)?대씪 ??긽 ?듦낵
 * ??provider: 紐낆떆媛믪씠 `anthropic`???꾨땲硫?500 `no provider configured`(湲곗〈 ?뚮챸???붿껌? ?泥댄븯吏 ?딅뒗?ㅳ띿? 媛숇떎)
 *    쨌 ???놁쓬 500 ??肄붿뼱 `refine()` ???섏?硫?400 `{error: message}` ??吏??湲곕줉 ??200
 *
 * ?뵶 **?댁삤踰??놁쓬.** ??Worker?먮뒗 provider媛 Claude ?섎굹肉먯씠??湲곗〈 ?ъ뒳 gemini ??openai ??gpt-4.1? Functions???⑥쓬).
 *    ?쒕룄쨌??臾몄젣硫?肄붿뼱媛 ?대갚 ?묐떟(`fallback:true, fallbackReason`)??洹몃?濡??몃떎 ???뺤옣? ?뚭탳?뺥븯吏 紐삵뻽?댁슂??
 * ?뵶 Zero Retention (Spec ?꾩닔 5): 濡쒓렇?먮뒗 provider쨌湲닿툒?꽷룹쓽?꽷룹틦?쑣룻뤃諛??ъ쑀쨌?쒓컙留? ?붿껌 蹂몃Ц쨌援먯젙臾맞? *    ?좏겙쨌?ㅻ뒗 ?대뼡 濡쒓렇?먮룄 ?곗? ?딅뒗????`test/handler.test.js` ?뚮줈洹몄뿉 蹂몃Ц ?놁쓬?띿씠 ?좉렐??
 */

import { refine, MemoryCacheStore } from '../../../src/core/refine/index.js';
import { readConfig } from './config.js';
import { AuthError, bearerToken, verifyFirebaseIdToken } from './auth.js';
import { corsHeaders, judgeOrigin } from './cors.js';
import { createNoopUsageStore } from './usageStore.js';

const PROVIDER = 'anthropic';
const NOT_IMPLEMENTED_MODES = new Set(['decode', 'decisions', 'reply']);

/**
 * ?뵶 ?ш퀬 ?꾧린 ?ㅼ쐞移??대뙌????肄붿뼱 `providers/anthropic.js`??`globalThis.process?.env?.SAI_ANTHROPIC_THINKING`?? *    ?쎈뒗??Node 寃쎈줈). Worker ?ㅼ젙? `env`濡??ㅻ?濡?洹?媛믪쓣 `process.env`????꺼 以????**肄붿뼱瑜?怨좎튂吏 ?딆쑝?ㅺ퀬**.
 *    `nodejs_compat`(compat date ??2025-04-01)?먯꽌??vars媛 `process.env`???먮룞?쇰줈 ?ㅼ뼱?⑤떎怨??뚮젮???덉?留? *    (?뵶 異붿젙 ??諛고룷 ??`/health`??`thinking`쨌?붿껌 蹂몃Ц?쇰줈 ?뺤씤), ?섏〈?섏? ?딄퀬 紐낆떆?곸쑝濡??ｋ뒗??
 * @returns {boolean} ??꼈?붿?(`process.env`媛 ?놁쑝硫?false ??洹몃븣???ш퀬媛 耳쒖쭊 梨꾨줈 媛꾨떎).
 */
export function applyThinkingSwitch(value) {
  if (value === undefined) return false;
  const env = globalThis.process?.env;
  if (!env) return false;
  env.SAI_ANTHROPIC_THINKING = value;
  return true;
}

/**
 * @param {object} [deps] ?꾨? ?뚯뒪??二쇱엯?? ?댁쁺 湲곕낯媛믪? `index.js`.
 * @param {Function} [deps.jwks] jose ??臾띠쓬(?뚯뒪?몃뒗 `createLocalJWKSet`).
 * @param {object} [deps.usageStore] `usageStore.js` ?명꽣?섏씠??
 * @param {typeof fetch} [deps.fetchImpl] Anthropic SDK???섍만 fetch(?뚯뒪?몃뒗 媛吏??묐떟).
 * @param {object} [deps.cache] 肄붿뼱 罹먯떆 ?ㅽ넗??
 * @param {() => number} [deps.now]
 * @param {{log: Function, warn: Function, error: Function}} [deps.logger] 湲곕낯 console.
 */
export function createHandler(deps = {}) {
  const {
    jwks,
    usageStore = createNoopUsageStore(),
    fetchImpl,
    // ?뵶 isolate 硫붾え由??꾩슜(Zero Retention 寃쎄퀎 ??肄붿뼱 cache.js? 媛숇떎). isolate媛 ?щ윭 媛쒕씪 ?곸쨷瑜좎? ??떎.
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
      logger.warn('[cors] ?덉슜?섏? ?딆? ?ㅻ━吏???嫄곗젅');
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
      // ?뵶 ??媛믪? ?덈? ?대낫?댁? ?딅뒗?????덈뒗吏留?
      return json(200, {
        ok: true,
        runtime: 'cloudflare-workers',
        stage: 1,
        provider: PROVIDER,
        availableProviders: config.anthropicKey ? [PROVIDER] : [],
        configured: Boolean(config.anthropicKey) && config.missing.length === 0,
        missingConfig: config.missing,
        model: config.model ?? null,
        thinking: config.thinking ?? 'default',
        usageStore: usageStore.kind ?? 'custom',
      });
    }

    if (url.pathname !== '/v1/refine') return json(404, { error: 'not found' });
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

    const receivedAt = now();

    if (config.missing.length > 0) {
      logger.error(`[refine] ?ㅼ젙 ?꾨씫: ${config.missing.join(',')}`);
      return json(500, { error: 'server misconfigured' });
    }

    // ???몄쬆 ???뵶 紐⑹뾽?쇰줈 ????듯븯吏 ?딅뒗??湲곗〈 refineV1 二쇱꽍怨?媛숇떎). ?뺤옣??401??蹂닿퀬 濡쒓렇?몄쓣 ?꾩슫??
    let uid;
    try {
      ({ uid } = await verifyFirebaseIdToken(bearerToken(request), {
        projectId: config.projectId,
        ...(jwks ? { jwks } : {}),
        now,
      }));
    } catch (error) {
      const reason = error instanceof AuthError ? error.reason : 'bad-token';
      // ?뵶 jose ?ㅻ쪟 肄붾뱶留??? ERR_JWT_EXPIRED) ???좏겙 臾몄옄?는룻겢?덉엫? ?④린吏 ?딅뒗??
      logger.warn(`[refine] ?몄쬆 嫄곗젅 reason=${reason} code=${error?.code ?? '-'}`);
      return json(401, { error: 'unauthorized', reason });
    }

    // ??蹂몃Ц
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'bad request' });
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad request' });

    // ??1?④퀎 踰붿쐞 諛?mode ???곹븳쨌LLM???곌린 ?꾩뿉 ?딅뒗??
    if (NOT_IMPLEMENTED_MODES.has(body.mode)) {
      return json(501, { error: 'not implemented', mode: body.mode });
    }

    // ???쇱씪 ?곹븳 ???뵶 1?④퀎 ?ㅽ뀅. 湲곗〈怨?媛숈씠 **移댁슫???μ븷濡?援먯젙??硫덉텛吏 ?딅뒗??*.
    try {
      const quota = await usageStore.consumeDailyQuota(uid);
      if (!quota.ok) {
        logger.warn(`[refine] ?쇱씪 ?곹븳 珥덇낵 used=${quota.used} limit=${quota.limit}`);
        return json(429, { error: 'daily-limit', limit: quota.limit });
      }
      if (quota.used === 1) await safeMetric(logger, () => usageStore.recordDailyUser(uid));
    } catch (error) {
      logger.error(`[refine] ?곹븳 ?뺤씤 ?ㅽ뙣 ???듦낵?쒗궡: ${error?.code ?? error?.name ?? 'unknown'}`);
    }

    // ??provider ??紐낆떆 ?붿껌? ?泥댄븯吏 ?딅뒗??
    if ((body.provider && body.provider !== PROVIDER) || !config.anthropicKey) {
      logger.error('[refine] ?ъ슜?????덈뒗 provider ?ㅺ? ?놁뒿?덈떎 ??wrangler secret put ANTHROPIC_API_KEY ?꾩슂');
      return json(500, { error: 'no provider configured' });
    }

    applyThinkingSwitch(config.thinking);

    // ??肄붿뼱
    let result;
    try {
      result = await refine(body, {
        apiKey: config.anthropicKey,
        provider: PROVIDER,
        model: config.model,
        cache,
        ...(fetchImpl ? { fetchImpl } : {}),
        now,
        logger: (event) =>
          logger.log(
            `[refine] provider=${PROVIDER}${config.model ? `/${config.model}` : ''} urgency=${event.urgency ?? '-'} ` +
              `intent=${event.detectedIntent ?? '-'} cache=${event.cacheHit ? 'hit' : 'miss'} ` +
              `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'} ${event.latencyMs}ms`,
          ),
      });
    } catch (error) {
      // ?뵶 肄붿뼱??RefineRequestError 臾멸뎄???곕━ 臾멸뎄??蹂몃Ц ?놁쓬). 洹?諛??ㅻ쪟???대쫫留?濡쒓렇??
      logger.error(`[refine] ?붿껌 嫄곗젅: ${error?.name ?? 'error'}`);
      await safeMetric(logger, () =>
        usageStore.recordRequest({ mode: 'refine', rejected: true, latencyMs: now() - receivedAt }),
      );
      return json(400, { error: error?.message ?? 'bad request' });
    }

    // ??吏????紐⑤뱶쨌?깃났 ?щ?쨌?ъ쑀 肄붾뱶쨌?쒓컙肉?
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

/** 吏???ㅽ뙣媛 援먯젙??留됱? ?딅뒗??L20). 濡쒓렇?먮뒗 ?ㅻ쪟 肄붾뱶留? */
async function safeMetric(logger, write) {
  try {
    await write();
  } catch (error) {
    logger.error(`[metrics] 湲곕줉 ?ㅽ뙣: ${error?.code ?? error?.name ?? 'unknown'}`);
  }
}
