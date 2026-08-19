/**
 * S22 — GitHub 수집 클라이언트 단위 테스트 (Spec audit 3 · 필수 5).
 *
 * 🔴 이 테스트가 지키려는 핵심:
 *    ① **스코프를 절대 요청하지 않는다** — 요청 본문에 `scope`가 들어가면 실패한다.
 *    ② **실패 사유를 뭉뚱그리지 않는다** — 404·403·네트워크가 각각 다른 코드로 나온다.
 *    ③ **3페이지를 받는다** — 1페이지만 받던 결함(2026-08-14 실측)이 되살아나면 잡힌다.
 *    ④ 토큰 저장에 **사용자명·이메일이 함께 들어가지 않는다.**
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  startDeviceFlow,
  pollForToken,
  interpretTokenResponse,
  fetchPublicEvents,
  storeToken,
  getStoredToken,
  clearToken,
  errorMessage,
  GITHUB_ERRORS,
} from '../src/lib/githubClient.js';
import { getLocal, STORAGE_KEYS } from '../src/lib/storage.js';

/** fetch 흉내 — 호출 기록을 남긴다. */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const result = handler(url, init, calls.length);
    return {
      ok: result.status === undefined || (result.status >= 200 && result.status < 300),
      status: result.status ?? 200,
      json: async () => result.body,
    };
  };
  impl.calls = calls;
  return impl;
}

const noSleep = async () => {};

/* ── 스코프를 요청하지 않는다 ───────────────────────────────────────── */

test('🔴 디바이스 코드 요청에 scope가 들어가지 않는다 (공개 데이터만 읽는다)', async () => {
  const impl = fakeFetch(() => ({
    body: { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://x', interval: 5 },
  }));
  await startDeviceFlow(impl);

  const sent = JSON.parse(impl.calls[0].init.body);
  assert.equal('scope' in sent, false, 'scope를 보내고 있다');
  assert.ok(sent.client_id, 'client_id가 없다');
});

test('🔴 토큰 교환 요청에도 scope가 들어가지 않는다', async () => {
  const impl = fakeFetch(() => ({ body: { access_token: 'tok' } }));
  await pollForToken(
    { deviceCode: 'dc', interval: 1, expiresIn: 60 },
    { fetchImpl: impl, sleepImpl: noSleep },
  );
  const sent = JSON.parse(impl.calls[0].init.body);
  assert.equal('scope' in sent, false);
  assert.equal(sent.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
});

/* ── Device Flow 분기 ───────────────────────────────────────────────── */

test('Device Flow가 꺼져 있으면 그 사유로 알려준다 — "앱 없음"으로 오해시키지 않는다', async () => {
  const impl = fakeFetch(() => ({ status: 404, body: { error: 'Not Found' } }));
  await assert.rejects(
    () => startDeviceFlow(impl),
    (error) => error.reason === GITHUB_ERRORS.DEVICE_FLOW_OFF,
  );
});

test('폴링 응답 해석 — 모든 분기', () => {
  assert.deepEqual(interpretTokenResponse({ access_token: 't' }), {
    status: 'ok',
    accessToken: 't',
  });
  assert.equal(interpretTokenResponse({ error: 'authorization_pending' }).status, 'pending');
  assert.equal(interpretTokenResponse({ error: 'slow_down', interval: 12 }).interval, 12);
  assert.equal(interpretTokenResponse({ error: 'expired_token' }).reason, GITHUB_ERRORS.EXPIRED);
  assert.equal(interpretTokenResponse({ error: 'access_denied' }).reason, GITHUB_ERRORS.DENIED);
  assert.equal(interpretTokenResponse({}).reason, GITHUB_ERRORS.UNKNOWN);
});

test('🔴 slow_down을 받으면 간격을 늘려 따른다 — 무시하면 차단된다', async () => {
  const impl = fakeFetch((url, init, n) =>
    n === 1 ? { body: { error: 'slow_down', interval: 30 } } : { body: { access_token: 'tok' } },
  );
  const waited = [];
  const token = await pollForToken(
    { deviceCode: 'dc', interval: 5, expiresIn: 600 },
    { fetchImpl: impl, sleepImpl: async (ms) => waited.push(ms) },
  );
  assert.equal(token, 'tok');
  assert.deepEqual(waited, [5000, 30000], '간격을 늘리지 않았다');
});

test('사용자가 취소하면 폴링을 멈춘다', async () => {
  const impl = fakeFetch(() => ({ body: { error: 'authorization_pending' } }));
  await assert.rejects(
    () =>
      pollForToken(
        { deviceCode: 'dc', interval: 1, expiresIn: 600 },
        { fetchImpl: impl, sleepImpl: noSleep, isCancelled: () => true },
      ),
    (error) => error.reason === GITHUB_ERRORS.DENIED,
  );
  assert.equal(impl.calls.length, 0, '취소했는데 요청을 보냈다');
});

/* ── 수집 ───────────────────────────────────────────────────────────── */

test('🔴 3페이지를 받는다 — 1페이지만 받으면 표본이 모자란다 (2026-08-14 실측 결함)', async () => {
  const full = Array.from({ length: 100 }, () => ({ type: 'PushEvent' }));
  const impl = fakeFetch(() => ({ body: full }));
  const events = await fetchPublicEvents('someone', { fetchImpl: impl, token: null });
  assert.equal(impl.calls.length, 3, `${impl.calls.length}페이지만 받았다`);
  assert.equal(events.length, 300);
  assert.match(impl.calls[2].url, /page=3/);
});

test('100건 미만이 오면 거기서 멈춘다 — 빈 요청으로 한도를 쓰지 않는다', async () => {
  const impl = fakeFetch(() => ({ body: [{ type: 'PushEvent' }] }));
  await fetchPublicEvents('someone', { fetchImpl: impl, token: null });
  assert.equal(impl.calls.length, 1);
});

test('🔴 실패 사유를 구분한다 — 404 / 403 / 네트워크', async () => {
  const notFound = fakeFetch(() => ({ status: 404, body: {} }));
  await assert.rejects(
    () => fetchPublicEvents('nope', { fetchImpl: notFound, token: null }),
    (e) => e.reason === GITHUB_ERRORS.NO_USER,
  );

  const limited = fakeFetch(() => ({ status: 403, body: {} }));
  await assert.rejects(
    () => fetchPublicEvents('someone', { fetchImpl: limited, token: null }),
    (e) => e.reason === GITHUB_ERRORS.RATE_LIMIT,
  );

  const dead = async () => {
    throw new Error('offline');
  };
  await assert.rejects(
    () => fetchPublicEvents('someone', { fetchImpl: dead, token: null }),
    (e) => e.reason === GITHUB_ERRORS.NETWORK,
  );
});

test('사용자명 앞의 @와 공백을 떼고 URL 인코딩한다', async () => {
  const impl = fakeFetch(() => ({ body: [] }));
  await fetchPublicEvents('  @some one ', { fetchImpl: impl, token: null });
  assert.match(impl.calls[0].url, /users\/some%20one\/events/);
});

test('토큰이 있으면 Authorization 헤더를 붙이고, 없으면 안 붙인다', async () => {
  const withToken = fakeFetch(() => ({ body: [] }));
  await fetchPublicEvents('x', { fetchImpl: withToken, token: 'abc' });
  assert.equal(withToken.calls[0].init.headers.Authorization, 'Bearer abc');

  const without = fakeFetch(() => ({ body: [] }));
  await fetchPublicEvents('x', { fetchImpl: without, token: null });
  assert.equal('Authorization' in without.calls[0].init.headers, false);
});

/* ── 토큰 보관 ──────────────────────────────────────────────────────── */

test('🔴 토큰 저장에 사용자명·이메일이 함께 들어가지 않는다', async () => {
  await storeToken('secret-token');
  const stored = await getLocal(STORAGE_KEYS.GITHUB_TOKEN, null);
  assert.deepEqual(Object.keys(stored).sort(), ['accessToken', 'linkedAt']);
  assert.equal(await getStoredToken(), 'secret-token');

  await clearToken();
  assert.equal(await getStoredToken(), null);
});

test('모든 실패 사유에 사람이 읽을 문구가 있다', () => {
  for (const reason of Object.values(GITHUB_ERRORS)) {
    const message = errorMessage(reason);
    assert.ok(message.length > 0, `${reason}에 문구가 없다`);
    assert.ok(!message.includes('undefined'));
  }
});
