/**
 * Firebase ID ?좏겙 寃利???**firebase-admin ?놁씠** (`jose` + WebCrypto).
 *
 * ?뵶 ??吏곸젒 ?섎굹: `firebase-admin`? Node ?꾩슜(gRPC쨌node:http2쨌?쒕퉬??怨꾩젙 ?뚯씪)?대씪 Worker?먯꽌 紐??대떎.
 *    ID ?좏겙? Google securetoken ?ㅻ줈 ?쒕챸??RS256 JWT??肉먯씠?? 怨듦컻??JWKS)濡??쒕챸怨??대젅?꾨쭔
 *    蹂대㈃ `verifyIdToken`怨?媛숈? ?먯젙???????덈떎(Firebase 臾몄꽌 ?똙erify ID tokens using a third-party
 *    JWT library?띿쓽 議곌굔?쒕? 洹몃?濡???꼈??.
 *
 * ?먯젙????**?쒖뿉 ?녿뒗 議곌굔???꾩쓽濡??듦낵?쒗궎吏 ?딅뒗??**
 * | 寃??| 湲곕? | ?ㅽ뙣 ??|
 * |---|---|---|
 * | ?ㅻ뜑 `alg` | `RS256`留?| bad-token (`none`쨌HS256 ?쇰룞 怨듦꺽 李⑤떒) |
 * | ?ㅻ뜑 `kid` | JWKS???덈뒗 ??| bad-token |
 * | ?쒕챸 | 洹??ㅻ줈 寃利?| bad-token |
 * | `exp` | 誘몃옒 | bad-token |
 * | `iat` | 怨쇨굅(?덉슜 ?ㅼ감 ?? | bad-token |
 * | `iss` | `https://securetoken.google.com/<projectId>` | bad-token |
 * | `aud` | `<projectId>` | bad-token |
 * | `sub` | 鍮꾩뼱 ?덉? ?딆? 臾몄옄?는?28???댄븯 ??uid | bad-token |
 * | `auth_time` | 怨쇨굅(?덉슜 ?ㅼ감 ?? | bad-token |
 *
 * ?뵶 **?먭린(revoke) ?뺤씤? ?섏? ?딅뒗??* ??firebase-admin??`checkRevoked: true`???뚮쭔 ?쒕떎(湲곗〈 ?쒕쾭??????.
 *    怨꾩젙??吏?뚮룄 ?좏겙? 留뚮즺(理쒕? 1?쒓컙)源뚯? ?곕떎 ??湲곗〈怨?媛숈? ?섏?.
 * ?뵶 401 ?ъ쑀??`teams.js` `requireAuth`? 媛숈? ??媛쒕퓧?대떎(`no-token` / `bad-token`). ?ㅽ뙣 ?곸꽭(留뚮즺?몄?
 *    audience?몄?)???묐떟???ｌ? ?딅뒗????怨듦꺽?먯뿉寃??뚰듃瑜?二쇱? ?딅뒗?? 濡쒓렇?먮룄 jose ?ㅻ쪟 **肄붾뱶**留?
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { SECURETOKEN_JWKS_URL } from './config.js';

/** ?쒓퀎 李⑥씠 ?덉슜(珥?. firebase-admin怨?鍮꾩듂???섏??쇰줈 ?묎쾶. */
const CLOCK_TOLERANCE_SEC = 5;

export class AuthError extends Error {
  /** @param {'no-token'|'bad-token'} reason @param {string} [code] jose ?ㅻ쪟 肄붾뱶(濡쒓렇??. */
  constructor(reason, code) {
    super(`auth:${reason}`);
    this.name = 'AuthError';
    this.reason = reason;
    this.code = code;
  }
}

/**
 * ?뵶 **JWKS 罹먯떆** ??紐⑤뱢(=isolate) ?섏????섎굹留??붾떎. jose???먭꺽 ??臾띠쓬? 諛쏆븘 ???ㅻ? 湲곗뼲?섍퀬,
 *    紐⑤Ⅴ??`kid`媛 ?ㅻ㈃(??援먯껜) ?ㅼ떆 諛쏅뒗??cooldown 30珥????꾩“ kid濡?Google???먮뱶由щ뒗 寃?諛⑹?).
 *    isolate媛 ?댁븘 ?덈뒗 ?숈븞 ?붿껌留덈떎 Google??遺瑜댁? ?딅뒗?? ?뵶 isolate媛 ?덈줈 ?⑤㈃ 泥??붿껌? ??踰?諛쏅뒗?? *    ??洹??湲곕뒗 fetch??CPU ?쒓컙?먮뒗 ???ㅼ뼱媛꾨떎(踰쎌떆怨?吏?곗뿉???ㅼ뼱媛꾨떎).
 */
let remoteJwks = null;
export function defaultJwks() {
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(new URL(SECURETOKEN_JWKS_URL), {
      cacheMaxAge: 60 * 60 * 1000, // 1?쒓컙 ??Google? ?ㅻ? ?섎（ ?⑥쐞濡??뚮┛???뵶 異붿젙, ?묐떟 Cache-Control濡??뺤씤 媛??
      cooldownDuration: 30_000,
    });
  }
  return remoteJwks;
}

/** `Authorization: Bearer <token>` ??token. ?놁쑝硫?''. */
export function bearerToken(request) {
  const header = request.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * @param {string} token
 * @param {{ projectId: string, jwks?: Function, now?: () => number }} options
 *   `jwks`???뚯뒪?몄뿉??`createLocalJWKSet`?쇰줈 二쇱엯?쒕떎(?ㅽ듃?뚰겕 ?놁씠).
 * @returns {Promise<{ uid: string, email: string|null }>}
 */
export async function verifyFirebaseIdToken(token, { projectId, jwks = defaultJwks(), now } = {}) {
  if (!token) throw new AuthError('no-token');
  if (!projectId) throw new AuthError('bad-token', 'no-project-id'); // ?ㅼ젙 ?꾨씫 ???꾨Т ?좏겙???듦낵?쒗궎吏 ?딅뒗??
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      clockTolerance: CLOCK_TOLERANCE_SEC,
      requiredClaims: ['exp', 'iat', 'sub', 'auth_time'],
      ...(now ? { currentDate: new Date(now()) } : {}),
    }));
  } catch (error) {
    throw new AuthError('bad-token', error?.code ?? error?.name ?? 'unknown');
  }

  const nowSec = Math.floor((now ? now() : Date.now()) / 1000);
  // jose??iat???뚮????щ??띾? 湲곕낯?쇰줈 蹂댁? ?딅뒗????Firebase 議곌굔?쒕?濡?吏곸젒 蹂몃떎.
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + CLOCK_TOLERANCE_SEC) {
    throw new AuthError('bad-token', 'iat-in-future');
  }
  if (typeof payload.auth_time !== 'number' || payload.auth_time > nowSec + CLOCK_TOLERANCE_SEC) {
    throw new AuthError('bad-token', 'auth-time-in-future');
  }
  if (typeof payload.sub !== 'string' || payload.sub === '' || payload.sub.length > 128) {
    throw new AuthError('bad-token', 'bad-sub');
  }
  return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
}
