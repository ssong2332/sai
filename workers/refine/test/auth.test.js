/**
 * Firebase ID 토큰 검증(jose) — `src/auth.js` 판정표의 행마다 한 건 이상.
 * 🔴 네트워크 없음 — 키는 로컬 생성, JWKS는 `createLocalJWKSet`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

import { AuthError, verifyFirebaseIdToken } from '../src/auth.js';
import { PROJECT_ID, makeKeys, signIdToken } from './helpers.js';

const keys = await makeKeys();
const verify = (token, extra = {}) => verifyFirebaseIdToken(token, { projectId: PROJECT_ID, jwks: keys.jwks, ...extra });

async function rejects(promise, reason = 'bad-token') {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AuthError, `AuthError가 아니다: ${error?.name}`);
    assert.equal(error.reason, reason);
    return true;
  });
}

test('정상 토큰 → uid(sub)·email', async () => {
  const result = await verify(await signIdToken(keys));
  assert.deepEqual(result, { uid: 'uid-test-123', email: 'tester@example.com' });
});

test('토큰 없음 → no-token', async () => {
  await rejects(verify(''), 'no-token');
});

test('만료 → bad-token', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  await rejects(verify(await signIdToken(keys, { iat: nowSec - 7200, auth_time: nowSec - 7200, exp: nowSec - 3600 })));
});

test('다른 프로젝트 audience → bad-token', async () => {
  await rejects(verify(await signIdToken(keys, { aud: 'other-project' })));
});

test('다른 issuer → bad-token', async () => {
  await rejects(verify(await signIdToken(keys, { iss: 'https://securetoken.google.com/other-project' })));
  await rejects(verify(await signIdToken(keys, { iss: 'https://accounts.google.com' })));
});

test('🔴 모르는 키로 서명(위조) → bad-token', async () => {
  const forger = await makeKeys('test-kid-1'); // 같은 kid, 다른 키
  await rejects(verify(await signIdToken(forger)));
});

test('🔴 RS256 외 알고리즘(HS256) → bad-token', async () => {
  const token = await new SignJWT({ sub: 'x', aud: PROJECT_ID, iss: `https://securetoken.google.com/${PROJECT_ID}` })
    .setProtectedHeader({ alg: 'HS256', kid: keys.kid })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode('a-shared-secret-of-sufficient-length-123'));
  await rejects(verify(token));
});

test('iat·auth_time이 미래 → bad-token', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  await rejects(verify(await signIdToken(keys, { iat: nowSec + 600 })));
  await rejects(verify(await signIdToken(keys, { auth_time: nowSec + 600 })));
});

test('sub 없음·빈 값·128자 초과 → bad-token', async () => {
  await rejects(verify(await signIdToken(keys, { sub: '' })));
  await rejects(verify(await signIdToken(keys, { sub: 'x'.repeat(129) })));
  await rejects(verify(await signIdToken(keys, { sub: undefined })));
});

test('auth_time 없음 → bad-token', async () => {
  await rejects(verify(await signIdToken(keys, { auth_time: undefined })));
});

test('🔴 프로젝트 ID 설정 누락이면 정상 토큰도 통과시키지 않는다', async () => {
  await rejects(verifyFirebaseIdToken(await signIdToken(keys), { projectId: '', jwks: keys.jwks }));
});

test('형식이 깨진 문자열 → bad-token', async () => {
  await rejects(verify('not-a-jwt'));
});
