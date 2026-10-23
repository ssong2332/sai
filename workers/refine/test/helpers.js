/**
 * Worker 테스트 공용 — 🔴 **네트워크 없음.** 서명 키는 jose로 로컬 생성, Claude 응답은 가짜 fetch.
 * 가짜 fetch를 안 넘기면 SDK가 실제 api.anthropic.com을 부르므로, 모든 refine 요청은 `fakeAnthropicFetch`를 거친다.
 */

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

export const PROJECT_ID = 'sai-global-msg-2026';
export const EXTENSION_ID = 'ogbcccaaojphhgobeeidpafokjieckdf';
export const EXT_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

/** 테스트용 env — 키는 지어낸 문자열(실제 키 아님). */
export const TEST_ENV = Object.freeze({
  FIREBASE_PROJECT_ID: PROJECT_ID,
  EXTENSION_ID,
  ANTHROPIC_API_KEY: 'test-key-not-real',
  // 🔴 2026-10-23부터 사고 끔이 코어 기본 — 여기서 켜거나 끄지 않는다(기본값이 실제로 끄는지를 시험한다).
});

/** 사슬 두 단계 키가 다 있는 env (폴오버 시험용). 값은 지어낸 문자열. */
export const CHAIN_ENV = Object.freeze({ ...TEST_ENV, GROQ_API_KEY: 'test-groq-key-not-real' });

/** RS256 키 한 쌍 + 그 공개키만 담은 로컬 JWKS. */
export async function makeKeys(kid = 'test-kid-1') {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { privateKey, kid, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

/**
 * Firebase ID 토큰 모양의 JWT. `overrides`로 클레임을 바꾼다(만료·audience·issuer 시험).
 * @param {{privateKey: CryptoKey, kid: string}} keys
 */
export async function signIdToken(keys, overrides = {}, { alg = 'RS256' } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const claims = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: 'uid-test-123',
    auth_time: nowSec - 60,
    iat: nowSec - 30,
    exp: nowSec + 3600,
    email: 'tester@example.com',
    ...overrides,
  };
  return new SignJWT(claims).setProtectedHeader({ alg, kid: keys.kid, typ: 'JWT' }).sign(keys.privateKey);
}

/** 코어 schema.js를 통과하는 Claude 응답 JSON(합성 — `test/anthropicProvider.unit.test.js` goodRaw와 같은 모양). */
export function goodRaw() {
  return {
    urgency: 'NORMAL',
    urgencyReason: '통상적인 업무 요청입니다.',
    refined: 'Could you review this by tomorrow morning?',
    refinedReason: '요청을 명시적으로 바꿨습니다.',
    preserved: [],
    misreadRisks: [],
    backTranslation: '내일 오전까지 검토해 주실 수 있을까요?',
    detectedIntent: 'normal',
    intentEvidence: null,
    ticket: null,
    appliedGlossary: [],
    unregisteredHonorifics: [],
  };
}

/** Messages API 응답을 돌려주는 가짜 fetch. 받은 요청 본문을 `seen`에 기록한다. */
export function fakeAnthropicFetch(raw = goodRaw(), { status = 200 } = {}) {
  const seen = { calls: 0, bodies: [], urls: [] };
  const impl = async (url, init) => {
    seen.calls += 1;
    seen.urls.push(String(url));
    seen.bodies.push(JSON.parse(init.body));
    const body =
      status === 200
        ? {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-5-5',
            content: [{ type: 'text', text: JSON.stringify(raw) }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 4900, output_tokens: 410 },
          }
        : { type: 'error', error: { type: 'rate_limit_error', message: 'test' } };
    return new globalThis.Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  impl.seen = seen;
  return impl;
}

/**
 * 폴오버 시험용 — URL로 provider를 가려 각각 정해진 상태로 답하는 가짜 fetch (2026-10-23).
 * 🔴 네트워크 없음. 어느 provider를 몇 번 불렀는지 `seen.byProvider`에 남긴다(본문은 모양 검사용으로만 보관).
 * @param {Record<'anthropic'|'groq'|'gemini'|'openai', number>} statusByProvider 없으면 200.
 *   429 → 한도(quota) · 401 → 키 무효(auth) · 500 → 일반 오류(error).
 */
export function fakeMultiFetch(statusByProvider = {}, raw = goodRaw()) {
  const seen = { calls: 0, order: [], byProvider: {} };
  const providerOf = (url) => {
    if (url.startsWith('https://api.anthropic.com/')) return 'anthropic';
    if (url.startsWith('https://api.groq.com/')) return 'groq';
    if (url.startsWith('https://generativelanguage.googleapis.com/')) return 'gemini';
    if (url.startsWith('https://api.openai.com/')) return 'openai';
    return 'unknown';
  };
  const errorType = { 429: 'rate_limit_error', 401: 'authentication_error', 500: 'api_error' };
  const impl = async (url) => {
    const provider = providerOf(String(url));
    seen.calls += 1;
    seen.order.push(provider);
    seen.byProvider[provider] = (seen.byProvider[provider] ?? 0) + 1;
    const status = statusByProvider[provider] ?? 200;
    const reply = (body) =>
      new globalThis.Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (status !== 200) {
      return reply(
        provider === 'anthropic'
          ? { type: 'error', error: { type: errorType[status] ?? 'api_error', message: 'test' } }
          : { error: { code: status === 429 ? 'rate_limit_exceeded' : 'test_error', message: 'test' } },
      );
    }
    if (provider === 'anthropic') {
      return reply({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: JSON.stringify(raw) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 4900, output_tokens: 410 },
      });
    }
    if (provider === 'gemini') {
      return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(raw) }] }, finishReason: 'STOP' }] });
    }
    // groq·openai — OpenAI 호환 chat completions 모양.
    return reply({ choices: [{ message: { role: 'assistant', content: JSON.stringify(raw) } }] });
  };
  impl.seen = seen;
  return impl;
}

/** 로그를 모으는 logger — 「본문이 로그에 없다」를 검사한다. */
export function captureLogger() {
  const lines = [];
  const push = (...args) => lines.push(args.map(String).join(' '));
  return { lines, log: push, warn: push, error: push };
}

export function refineRequest(token, body, { origin = EXT_ORIGIN, method = 'POST', path = '/v1/refine' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  return new globalThis.Request(`https://sai-refine.example.workers.dev${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

export const BASE_BODY = Object.freeze({
  text: '내일 오전까지 리뷰 부탁드립니다',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-12',
});
