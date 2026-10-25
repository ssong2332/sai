/**
 * 서비스 계정 → Google OAuth 접근 토큰 (2026-10-26, L33 2단계 U1).
 *
 * 🔴 왜: 팀·명부·지표·사용량 문서는 규칙상 클라이언트가 쓸 수 없다(`firestore.rules` `allow write: if false`).
 *    Functions는 firebase-admin이 서버 권한으로 썼다. Worker에는 firebase-admin이 없으므로 서비스 계정 키로
 *    JWT를 서명해 접근 토큰을 받는다(RFC 7523 jwt-bearer). 서명은 이미 번들에 있는 `jose`(WebCrypto)로 한다.
 * 🔴 키는 Worker 시크릿 `GOOGLE_SERVICE_ACCOUNT`(JSON 원문)에서만 읽는다. 로그·오류 메시지에 키·토큰을 넣지 않는다 —
 *    오류는 사유 코드만(`ServiceAccountError.code`).
 * 🔴 토큰은 isolate 메모리에만 두고 만료 1분 전까지 재사용한다. 동시에 들어온 요청은 같은 발급을 기다린다.
 *
 * 판정표
 * | 입력 | 결과 |
 * |---|---|
 * | 시크릿 없음·JSON 아님·`client_email`/`private_key` 없음 | `ServiceAccountError('bad-credentials')` |
 * | 토큰 교환 응답이 2xx 아님·`access_token` 없음 | `ServiceAccountError('token-exchange')` (상태 코드만) |
 * | 캐시된 토큰이 만료 60초 전보다 이름 | 그대로 재사용 |
 */

import { SignJWT, importPKCS8 } from 'jose';

/** Firestore·Identity Toolkit을 함께 부르므로 cloud-platform 범위 하나로 받는다. */
export const TOKEN_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
export const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const REFRESH_MARGIN_MS = 60_000;

export class ServiceAccountError extends Error {
  constructor(code, detail = '') {
    super(`service account: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'ServiceAccountError';
    this.code = code;
  }
}

/** 시크릿 원문(JSON) → 쓰는 값만. 🔴 실패 메시지에 원문을 넣지 않는다. */
export function parseServiceAccount(raw) {
  let json;
  try {
    json = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new ServiceAccountError('bad-credentials', 'not json');
  }
  const clientEmail = typeof json?.client_email === 'string' ? json.client_email : '';
  const privateKey = typeof json?.private_key === 'string' ? json.private_key : '';
  if (!clientEmail || !privateKey) throw new ServiceAccountError('bad-credentials', 'missing fields');
  return {
    clientEmail,
    privateKey,
    projectId: typeof json.project_id === 'string' ? json.project_id : null,
    tokenUri: typeof json.token_uri === 'string' && json.token_uri ? json.token_uri : DEFAULT_TOKEN_URI,
  };
}

/**
 * @param {object} opts
 * @param {string|object} opts.credentials 서비스 계정 JSON(원문 또는 객체).
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {() => number} [opts.now] ms.
 * @param {string} [opts.scope]
 * @returns {{ token: () => Promise<string>, stats: { exchanges: number } }}
 */
export function createTokenSource({ credentials, fetchImpl = globalThis.fetch, now = () => Date.now(), scope = TOKEN_SCOPE }) {
  const account = parseServiceAccount(credentials);
  let keyPromise = null;
  let cached = null; // { value, expiresAt }
  let inflight = null;
  const stats = { exchanges: 0 };

  async function exchange() {
    keyPromise ??= importPKCS8(account.privateKey, 'RS256').catch((error) => {
      keyPromise = null;
      throw new ServiceAccountError('bad-credentials', error?.name ?? 'key');
    });
    const key = await keyPromise;
    const issuedAt = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.clientEmail)
      .setSubject(account.clientEmail)
      .setAudience(account.tokenUri)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(key);
    const response = await fetchImpl(account.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    stats.exchanges += 1;
    if (!response.ok) throw new ServiceAccountError('token-exchange', String(response.status));
    const body = await response.json().catch(() => null);
    if (typeof body?.access_token !== 'string') throw new ServiceAccountError('token-exchange', 'no token');
    const ttlMs = (Number.isFinite(body.expires_in) ? body.expires_in : 3600) * 1000;
    cached = { value: body.access_token, expiresAt: now() + ttlMs };
    return cached.value;
  }

  return {
    stats,
    projectId: account.projectId,
    async token() {
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) return cached.value;
      inflight ??= exchange().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
