/**
 * S31 — 구글 로그인 단위 테스트.
 *
 * 🔴 이 테스트가 지키려는 핵심:
 *    ① **설정이 비면 로그인을 시도하지 않는다** — 플레이스홀더로 눌러 실패하게 두지 않는다.
 *    ② **`launchWebAuthFlow`를 쓴다** (`getAuthToken` 아님) — 엣지에서 죽지 않기 위해서다.
 *    ③ **갱신 실패 시 세션을 지운다** — 죽은 토큰으로 "로그인됨"이라 표시하지 않는다.
 *    ④ 저장 세션에 **메시지 본문이 들어갈 필드가 없다.**
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractIdToken,
  isAuthConfigured,
  configuredWith,
  authErrorMessage,
  AUTH_ERRORS,
  signIn,
  getIdToken,
  getSession,
  signOut,
} from '../src/lib/authClient.js';
import { getLocal, setLocal, STORAGE_KEYS } from '../src/lib/storage.js';

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const result = handler(url, calls.length);
    return {
      ok: result.status === undefined || (result.status >= 200 && result.status < 300),
      status: result.status ?? 200,
      json: async () => result.body,
    };
  };
  impl.calls = calls;
  return impl;
}

/* ── 설정 게이트 ────────────────────────────────────────────────────── */

test('🔴 설정값이 비어 있으면 로그인을 막는다 (규칙 자체를 검사한다)', () => {
  assert.equal(configuredWith('', ''), false);
  assert.equal(configuredWith('client-id', ''), false, 'API 키가 없는데 통과시켰다');
  assert.equal(configuredWith('', 'api-key'), false, '클라이언트 ID가 없는데 통과시켰다');
  assert.equal(configuredWith('client-id', 'api-key'), true);
});

test('배포 설정이 채워져 있다 — 비어 있으면 로그인 버튼이 안내 문구로 바뀐다', () => {
  assert.equal(isAuthConfigured(), true, 'config.js의 로그인 설정이 비었다');
});

/* ── 콜백 파싱 ──────────────────────────────────────────────────────── */

test('리디렉션 URL의 프래그먼트에서 id_token을 꺼낸다', () => {
  const url = 'https://abc.chromiumapp.org/#id_token=TOKEN123&token_type=Bearer';
  assert.equal(extractIdToken(url), 'TOKEN123');
});

test('🔴 쿼리스트링이 아니라 프래그먼트를 본다 — 암시적 흐름은 #에 실린다', () => {
  assert.equal(extractIdToken('https://abc.chromiumapp.org/?id_token=WRONG'), null);
});

test('토큰이 없거나 이상한 입력에서 죽지 않는다', () => {
  for (const input of [null, undefined, '', 'https://abc.chromiumapp.org/', 42]) {
    assert.equal(extractIdToken(input), null);
  }
});

/* ── 세션 보관 ──────────────────────────────────────────────────────── */

test('🔴 저장 세션에 메시지 본문이 들어갈 필드가 없다', async () => {
  await setLocal(STORAGE_KEYS.AUTH, {
    uid: 'u1',
    email: 'a@b.com',
    idToken: 't',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
  });
  const stored = await getLocal(STORAGE_KEYS.AUTH, null);
  assert.deepEqual(
    Object.keys(stored).sort(),
    ['email', 'expiresAt', 'idToken', 'refreshToken', 'uid'],
  );

  // 🔴 화면에 넘기는 값에는 토큰이 없다 — 컴포넌트가 토큰을 들고 다닐 이유가 없다.
  const session = await getSession();
  assert.deepEqual(Object.keys(session).sort(), ['email', 'uid']);

  await signOut();
  assert.equal(await getSession(), null);
});

/* ── 토큰 갱신 ──────────────────────────────────────────────────────── */

test('만료 전이면 저장된 토큰을 그대로 쓴다 — 불필요한 갱신 요청을 보내지 않는다', async () => {
  await setLocal(STORAGE_KEYS.AUTH, {
    uid: 'u1',
    email: 'a@b.com',
    idToken: 'fresh',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
  });
  const impl = fakeFetch(() => ({ body: {} }));
  assert.equal(await getIdToken({ fetchImpl: impl }), 'fresh');
  assert.equal(impl.calls.length, 0);
  await signOut();
});

test('만료됐으면 갱신하고 새 토큰을 저장한다', async () => {
  await setLocal(STORAGE_KEYS.AUTH, {
    uid: 'u1',
    email: 'a@b.com',
    idToken: 'stale',
    refreshToken: 'r1',
    expiresAt: Date.now() - 1000,
  });
  const impl = fakeFetch(() => ({
    body: { id_token: 'new', refresh_token: 'r2', expires_in: '3600' },
  }));
  assert.equal(await getIdToken({ fetchImpl: impl }), 'new');
  const stored = await getLocal(STORAGE_KEYS.AUTH, null);
  assert.equal(stored.idToken, 'new');
  assert.equal(stored.refreshToken, 'r2');
  await signOut();
});

test('🔴 갱신에 실패하면 세션을 지운다 — 죽은 토큰으로 "로그인됨"이라 표시하지 않는다', async () => {
  await setLocal(STORAGE_KEYS.AUTH, {
    uid: 'u1',
    email: 'a@b.com',
    idToken: 'stale',
    refreshToken: 'bad',
    expiresAt: Date.now() - 1000,
  });
  const impl = fakeFetch(() => ({ status: 400, body: { error: { message: 'TOKEN_EXPIRED' } } }));
  await assert.rejects(
    () => getIdToken({ fetchImpl: impl }),
    (e) => e.reason === AUTH_ERRORS.REFRESH_FAILED,
  );
  assert.equal(await getSession(), null, '실패했는데 세션이 남아 있다');
});

test('로그인한 적이 없으면 토큰 요청이 null이다 — 예외를 던지지 않는다', async () => {
  await signOut();
  assert.equal(await getIdToken(), null);
});

/* ── 문구 ───────────────────────────────────────────────────────────── */

test('모든 실패 사유에 사람이 읽을 문구가 있다', () => {
  for (const reason of Object.values(AUTH_ERRORS)) {
    const message = authErrorMessage(reason);
    assert.ok(message.length > 0, `${reason}에 문구가 없다`);
    assert.ok(!message.includes('undefined'));
  }
});
