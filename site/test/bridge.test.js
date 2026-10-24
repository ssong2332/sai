import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_ERRORS,
  EXT_ID,
  createExtensionClient,
  describeError,
  interpretHello,
  normalizeResponse,
  sendToExtension,
} from '../src/bridge.js';
import { createFakeSend } from '../src/fakeBridge.js';

/** chrome.runtime 대역. `reply`가 함수면 (id, msg) → 응답, 'never'면 콜백을 부르지 않는다. */
function fakeRuntime({ reply, lastError = null, throws = false } = {}) {
  const calls = [];
  const runtime = {
    lastError: null,
    sendMessage(id, message, cb) {
      calls.push({ id, message });
      if (throws) throw new Error('Invalid extension id');
      if (reply === 'never') return;
      setTimeout(() => {
        runtime.lastError = lastError;
        cb(lastError ? undefined : reply(id, message));
        runtime.lastError = null;
      }, 1);
    },
  };
  return { runtime, calls };
}

test('chrome.runtime이 없으면 즉시 no_runtime (크롬이 아니거나 허용한 확장이 없음)', async () => {
  assert.deepEqual(await sendToExtension({ type: 'site:hello' }, { runtime: undefined }), {
    ok: false,
    error: BRIDGE_ERRORS.NO_RUNTIME,
  });
  assert.deepEqual(await sendToExtension({ type: 'site:hello' }, { runtime: {} }), {
    ok: false,
    error: BRIDGE_ERRORS.NO_RUNTIME,
  });
});

test('확장 id와 메시지를 그대로 넘기고 응답을 돌려준다', async () => {
  const { runtime, calls } = fakeRuntime({ reply: () => ({ ok: true, protocol: 1, version: '0.2.0' }) });
  const result = await sendToExtension({ type: 'site:hello' }, { runtime });
  assert.equal(calls[0].id, EXT_ID);
  assert.deepEqual(calls[0].message, { type: 'site:hello' });
  assert.equal(result.ok, true);
  assert.equal(result.version, '0.2.0');
});

test('runtime.lastError는 no_receiver로 바꾸고 원문 메시지를 싣지 않는다', async () => {
  const { runtime } = fakeRuntime({
    reply: () => ({ ok: true }),
    lastError: { message: 'Could not establish connection. Receiving end does not exist.' },
  });
  const result = await sendToExtension({ type: 'site:get' }, { runtime });
  assert.deepEqual(result, { ok: false, error: BRIDGE_ERRORS.NO_RECEIVER });
});

test('sendMessage가 동기적으로 던져도 reject하지 않고 no_receiver', async () => {
  const { runtime } = fakeRuntime({ throws: true });
  assert.deepEqual(await sendToExtension({ type: 'site:get' }, { runtime }), {
    ok: false,
    error: BRIDGE_ERRORS.NO_RECEIVER,
  });
});

test('응답이 없으면 타임아웃 후 timeout', async () => {
  const { runtime } = fakeRuntime({ reply: 'never' });
  const started = Date.now();
  const result = await sendToExtension({ type: 'site:hello' }, { runtime, timeoutMs: 40 });
  assert.deepEqual(result, { ok: false, error: BRIDGE_ERRORS.TIMEOUT });
  assert.ok(Date.now() - started >= 35);
});

test('타임아웃 뒤 늦게 온 응답은 무시된다(한 번만 resolve)', async () => {
  let late;
  const runtime = {
    lastError: null,
    sendMessage(_id, _m, cb) {
      late = cb;
    },
  };
  const result = await sendToExtension({ type: 'site:hello' }, { runtime, timeoutMs: 10 });
  assert.equal(result.error, BRIDGE_ERRORS.TIMEOUT);
  assert.doesNotThrow(() => late({ ok: true }));
});

test('normalizeResponse — 모양이 다르면 bad_response, 오류 코드가 없으면 failed', () => {
  assert.deepEqual(normalizeResponse(undefined), { ok: false, error: BRIDGE_ERRORS.BAD_RESPONSE });
  assert.deepEqual(normalizeResponse('yes'), { ok: false, error: BRIDGE_ERRORS.BAD_RESPONSE });
  assert.deepEqual(normalizeResponse({ settings: {} }), { ok: false, error: BRIDGE_ERRORS.BAD_RESPONSE });
  assert.deepEqual(normalizeResponse({ ok: false }), { ok: false, error: 'failed' });
  assert.deepEqual(normalizeResponse({ ok: false, error: 'forbidden_origin' }), {
    ok: false,
    error: 'forbidden_origin',
  });
});

test('interpretHello — 판정표', () => {
  assert.deepEqual(interpretHello({ ok: true, protocol: 1, version: '0.2.0', signedIn: true }), {
    state: 'connected',
    protocol: 1,
    version: '0.2.0',
    signedIn: true,
  });
  assert.equal(interpretHello({ ok: true }).state, 'outdated');
  assert.equal(interpretHello({ ok: true, protocol: 0 }).state, 'outdated');
  assert.equal(interpretHello({ ok: false, error: 'unknown_type' }).state, 'outdated');
  assert.equal(interpretHello({ ok: false, error: 'forbidden_origin' }).state, 'forbidden');
  for (const error of Object.values(BRIDGE_ERRORS)) {
    assert.equal(interpretHello({ ok: false, error }).state, 'not_connected');
  }
});

test('describeError — 모든 코드에 할 일이 담긴 문구, 모르는 코드도 빈 문자열이 아니다', () => {
  const codes = [...Object.values(BRIDGE_ERRORS), 'forbidden_origin', 'bad_request', 'unknown_type', 'failed', 'zzz'];
  for (const code of codes) {
    const text = describeError(code);
    assert.ok(typeof text === 'string' && text.length > 10, code);
  }
});

test('클라이언트가 계약대로 메시지를 만든다', async () => {
  const { runtime, calls } = fakeRuntime({ reply: () => ({ ok: true }) });
  const client = createExtensionClient({ runtime });
  await client.set('display', { backTranslation: false });
  await client.addGlossary({ sourceText: '배포', targetText: 'deploy', keepSource: false, language: 'en' });
  await client.updateGlossary('g1', { keepSource: true });
  await client.removeGlossary('g1');
  await client.removeLearned('shorter');
  await client.clearLearned();
  assert.deepEqual(
    calls.map((c) => c.message),
    [
      { type: 'site:set', section: 'display', patch: { backTranslation: false } },
      {
        type: 'site:glossary:add',
        entry: { sourceText: '배포', targetText: 'deploy', keepSource: false, language: 'en' },
      },
      { type: 'site:glossary:update', id: 'g1', patch: { keepSource: true } },
      { type: 'site:glossary:remove', id: 'g1' },
      { type: 'site:learned:remove', categoryId: 'shorter' },
      { type: 'site:learned:clear' },
    ],
  );
});

test('데모 브리지 — 같은 계약을 따르고 메모리에서만 바뀐다', async () => {
  const send = createFakeSend({ delayMs: 0 });
  const hello = await send({ type: 'site:hello' });
  assert.equal(interpretHello(hello).state, 'connected');

  const set = await send({ type: 'site:set', section: 'display', patch: { backTranslation: false } });
  assert.equal(set.settings.display.backTranslation, false);
  assert.deepEqual(await send({ type: 'site:set', section: 'nope', patch: {} }), { ok: false, error: 'bad_request' });

  const added = await send({ type: 'site:glossary:add', entry: { sourceText: ' 핫픽스 ', targetText: 'hotfix' } });
  assert.equal(added.glossary[0].sourceText, '핫픽스');
  const id = added.glossary[0].id;
  const kept = await send({ type: 'site:glossary:update', id, patch: { keepSource: true } });
  assert.equal(kept.glossary.find((g) => g.id === id).keepSource, true);
  const removed = await send({ type: 'site:glossary:remove', id });
  assert.equal(removed.glossary.some((g) => g.id === id), false);

  const cleared = await send({ type: 'site:learned:clear' });
  assert.deepEqual(cleared.learned.counts, {});
  assert.deepEqual(await send({ type: 'site:nope' }), { ok: false, error: 'unknown_type' });

  // 새 브리지는 처음 값 — 저장소에 쓰지 않았다는 뜻
  const fresh = await createFakeSend({ delayMs: 0 })({ type: 'site:get' });
  assert.equal(fresh.settings.display.backTranslation, true);
});
