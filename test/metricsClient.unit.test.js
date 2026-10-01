/**
 * 베타 지표 — 확장 쪽 전송 (L20, 2026-10-01). `src/lib/metricsClient.js`.
 * 🔴 지키는 것: 표에 없는 이름·로그인 전에는 **요청 자체를 보내지 않는다**, 보내는 본문은 `{action, kind}`뿐이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { sendClientMetric, METRIC_KINDS } from '../src/lib/metricsClient.js';
import { setLocal, removeLocal, STORAGE_KEYS } from '../src/lib/storage.js';

function recorder(status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}

const signIn = () =>
  setLocal(STORAGE_KEYS.AUTH, { uid: 'u1', idToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 });

test('로그인 전에는 보내지 않는다', async () => {
  await removeLocal(STORAGE_KEYS.AUTH);
  const fetchImpl = recorder();
  assert.deepEqual(await sendClientMetric(METRIC_KINDS.APPLIED, { fetchImpl }), { sent: false });
  assert.equal(fetchImpl.calls.length, 0);
});

test('🔴 표에 없는 이름은 보내지 않는다', async () => {
  await signIn();
  const fetchImpl = recorder();
  assert.deepEqual(await sendClientMetric('본문', { fetchImpl }), { sent: false });
  assert.equal(fetchImpl.calls.length, 0);
});

test('🔴 보내는 본문은 action·kind뿐이다', async () => {
  await signIn();
  const fetchImpl = recorder();
  assert.deepEqual(await sendClientMetric(METRIC_KINDS.UNDONE, { fetchImpl }), { sent: true });
  assert.deepEqual(fetchImpl.calls[0].body, { action: 'metric', kind: 'undone' });
  assert.match(fetchImpl.calls[0].url, /teamV1$/);
});

test('서버 오류·네트워크 실패는 조용히 sent:false', async () => {
  await signIn();
  assert.deepEqual(await sendClientMetric(METRIC_KINDS.APPLIED, { fetchImpl: recorder(500) }), { sent: false });
  const offline = async () => {
    throw new Error('offline');
  };
  assert.deepEqual(await sendClientMetric(METRIC_KINDS.APPLIED, { fetchImpl: offline }), { sent: false });
});
