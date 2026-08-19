/**
 * 구글 로그인 (S31 / `docs/WebSplit.md` B안 선행 조건).
 *
 * 🔴 **`chrome.identity.launchWebAuthFlow`를 쓴다 — `getAuthToken`이 아니다.** `getAuthToken`은
 *    크롬 전용이라 엣지에서 통째로 죽는다(2026-08-14 실측, Lessons #17). `launchWebAuthFlow`는
 *    양쪽 다 동작한다. 캘린더(S23)가 크롬 전용으로 남은 것과 달리 로그인은 처음부터 양쪽을 지원한다.
 *
 * 🔴 **Firebase SDK를 넣지 않는다.** REST(Identity Toolkit)로 붙인다 — 새 의존성 0개이고,
 *    MV3의 CSP가 SDK의 일부 경로를 막는 문제도 피한다. 이 프로젝트가 계속 지켜온 방식이다.
 *
 * 🔴 **클라이언트 시크릿이 없다.** 확장은 공개 클라이언트라 시크릿을 가질 수 없고, 가져서도 안 된다.
 *    `response_type=id_token`(암시적)으로 받으므로 교환 단계 자체가 없다.
 *
 * 🔴 **Zero Retention과 무관한 데이터만 다룬다** — 토큰·uid·이메일뿐이고 메시지 본문은 없다.
 *    다만 이 토큰으로 열리는 Firestore에 **무엇을 쓸 수 있는지는 `firestore.rules`가 필드
 *    화이트리스트로 못 박고 있다**(본문이 들어갈 자리가 규칙 수준에서 없다).
 */

import { GOOGLE_WEB_CLIENT_ID, FIREBASE_API_KEY } from '../config.js';
import { getLocal, setLocal, removeLocal, STORAGE_KEYS } from './storage.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SIGN_IN_WITH_IDP =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';

/** 🔴 만료 직전을 만료로 본다 — 정확히 만료 시각에 쓰면 요청이 도중에 죽는다. */
const EXPIRY_MARGIN_MS = 60_000;

export const AUTH_ERRORS = {
  NOT_CONFIGURED: 'not-configured',
  CANCELLED: 'cancelled',
  NO_ID_TOKEN: 'no-id-token',
  EXCHANGE_FAILED: 'exchange-failed',
  REFRESH_FAILED: 'refresh-failed',
  NETWORK: 'network-failed',
};

export class AuthError extends Error {
  constructor(reason, detail = '') {
    super(`auth:${reason}${detail ? ` (${detail})` : ''}`);
    this.reason = reason;
    this.detail = detail;
  }
}

export function authErrorMessage(reason, detail = '') {
  const suffix = detail ? ` (${detail})` : '';
  switch (reason) {
    case AUTH_ERRORS.NOT_CONFIGURED:
      return '로그인 설정이 아직 없어요 — 관리자에게 문의해 주세요';
    case AUTH_ERRORS.CANCELLED:
      return '로그인을 취소하셨어요';
    case AUTH_ERRORS.NO_ID_TOKEN:
      return `구글이 로그인 정보를 주지 않았어요 — OAuth 클라이언트의 리디렉션 URI를 확인해 주세요${suffix}`;
    case AUTH_ERRORS.EXCHANGE_FAILED:
      return `로그인 처리에 실패했어요 — Firebase 인증에서 구글 제공업체가 켜져 있는지 확인해 주세요${suffix}`;
    case AUTH_ERRORS.REFRESH_FAILED:
      return '로그인이 만료됐어요 — 다시 로그인해 주세요';
    case AUTH_ERRORS.NETWORK:
      return '로그인 서버에 연결하지 못했어요 — 네트워크를 확인해 주세요';
    default:
      return `로그인에 실패했어요${suffix}`;
  }
}

/**
 * 설정 게이트 — **순수 함수로 분리한다.**
 * 🔴 `isAuthConfigured()`를 직접 테스트하면 "지금 config에 값이 있는가"를 검사하게 되어, 값을
 *    채우는 순간 테스트가 깨진다(2026-08-14 실제로 깨졌다). 검사해야 하는 것은 **비었을 때 막느냐**
 *    라는 규칙이지 배포 설정값이 아니다.
 */
export function configuredWith(clientId, apiKey) {
  return Boolean(clientId && apiKey);
}

/** 설정값이 채워져 있는지. 🔴 플레이스홀더 상태로 버튼을 눌러 실패하게 두지 않는다. */
export function isAuthConfigured() {
  return configuredWith(GOOGLE_WEB_CLIENT_ID, FIREBASE_API_KEY);
}

/** 확장의 리디렉션 주소. `https://<확장ID>.chromiumapp.org/` 형태이며 OAuth 앱에 등록돼 있어야 한다. */
export function redirectUri(identityImpl = globalThis.chrome?.identity) {
  return identityImpl?.getRedirectURL?.() ?? '';
}

/**
 * 재생 공격 방지용 nonce. 🔴 구글이 `id_token`에 그대로 실어 돌려주므로 **매번 새로** 만든다.
 * `crypto.randomUUID`가 없는 환경(구형 테스트 러너)에서는 시각+난수로 떨어진다.
 */
function makeNonce() {
  return globalThis.crypto?.randomUUID?.() ?? `n${Date.now()}${Math.random().toString(36).slice(2)}`;
}

/** 리디렉션으로 돌아온 URL의 **프래그먼트**에서 id_token을 꺼낸다(암시적 흐름은 `#`에 실린다). */
export function extractIdToken(callbackUrl) {
  if (typeof callbackUrl !== 'string') return null;
  const hash = callbackUrl.split('#')[1];
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get('id_token');
}

function launchAuthFlow({ identityImpl, interactive = true }) {
  const identity = identityImpl ?? globalThis.chrome?.identity;
  if (!identity?.launchWebAuthFlow) {
    return Promise.reject(new AuthError(AUTH_ERRORS.NOT_CONFIGURED, 'no chrome.identity'));
  }

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', GOOGLE_WEB_CLIENT_ID);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('redirect_uri', redirectUri(identity));
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('nonce', makeNonce());
  // 🔴 계정을 매번 고르게 한다 — 계정이 여러 개인 사용자가 엉뚱한 계정으로 묶이는 사고를 막는다.
  url.searchParams.set('prompt', 'select_account');

  return new Promise((resolve, reject) => {
    identity.launchWebAuthFlow({ url: url.toString(), interactive }, (callbackUrl) => {
      const failure = globalThis.chrome?.runtime?.lastError;
      if (failure || !callbackUrl) {
        const raw = failure?.message ?? 'no callback';
        console.warn('[사이] 로그인 흐름 실패:', raw);
        reject(new AuthError(AUTH_ERRORS.CANCELLED, raw));
        return;
      }
      resolve(callbackUrl);
    });
  });
}

async function postJson(url, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError(AUTH_ERRORS.NETWORK);
  }
  const parsed = await response.json().catch(() => null);
  return { ok: response.ok, body: parsed };
}

/**
 * 로그인. 구글 id_token → Firebase 세션으로 바꾼다.
 *
 * @returns {Promise<{uid: string, email: string}>} 🔴 토큰은 반환하지 않는다 — 화면이 토큰을
 *   들고 다닐 이유가 없다. 필요한 곳은 `getIdToken()`으로 그때그때 받는다.
 */
export async function signIn({ fetchImpl = globalThis.fetch, identityImpl = undefined } = {}) {
  if (!isAuthConfigured()) throw new AuthError(AUTH_ERRORS.NOT_CONFIGURED);

  const callbackUrl = await launchAuthFlow({ identityImpl });
  const googleIdToken = extractIdToken(callbackUrl);
  if (!googleIdToken) throw new AuthError(AUTH_ERRORS.NO_ID_TOKEN, redirectUri(identityImpl));

  const { ok, body } = await postJson(
    `${SIGN_IN_WITH_IDP}?key=${FIREBASE_API_KEY}`,
    {
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: redirectUri(identityImpl),
      returnIdpCredential: true,
      returnSecureToken: true,
    },
    fetchImpl,
  );

  if (!ok || !body?.idToken || !body?.refreshToken) {
    throw new AuthError(AUTH_ERRORS.EXCHANGE_FAILED, body?.error?.message ?? 'no tokens');
  }

  const session = {
    uid: body.localId,
    email: body.email ?? '',
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    expiresAt: Date.now() + Number(body.expiresIn ?? 3600) * 1000,
  };
  await setLocal(STORAGE_KEYS.AUTH, session);
  return { uid: session.uid, email: session.email };
}

/** 지금 로그인 상태. 🔴 토큰 유효성까지 보지는 않는다 — 화면 표시용이다. */
export async function getSession() {
  const stored = await getLocal(STORAGE_KEYS.AUTH, null);
  if (!stored?.uid) return null;
  return { uid: stored.uid, email: stored.email ?? '' };
}

export async function signOut() {
  await removeLocal(STORAGE_KEYS.AUTH);
}

/**
 * Firestore REST에 쓸 ID 토큰. 만료됐으면 갱신한다.
 *
 * 🔴 갱신에 실패하면 **세션을 지운다.** 죽은 토큰을 들고 "로그인됨"이라고 표시하면, 동기화가
 *    조용히 실패하면서 화면만 멀쩡해 보인다.
 */
export async function getIdToken({ fetchImpl = globalThis.fetch } = {}) {
  const stored = await getLocal(STORAGE_KEYS.AUTH, null);
  if (!stored?.refreshToken) return null;
  if (stored.idToken && Date.now() < stored.expiresAt - EXPIRY_MARGIN_MS) return stored.idToken;

  const { ok, body } = await postJson(
    `${REFRESH_URL}?key=${FIREBASE_API_KEY}`,
    { grant_type: 'refresh_token', refresh_token: stored.refreshToken },
    fetchImpl,
  );

  if (!ok || !body?.id_token) {
    await removeLocal(STORAGE_KEYS.AUTH);
    throw new AuthError(AUTH_ERRORS.REFRESH_FAILED, body?.error?.message ?? 'no id_token');
  }

  await setLocal(STORAGE_KEYS.AUTH, {
    ...stored,
    idToken: body.id_token,
    refreshToken: body.refresh_token ?? stored.refreshToken,
    expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
  });
  return body.id_token;
}
