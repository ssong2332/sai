/**
 * 예전 데모 시드 청소 (2026-08-15).
 *
 * 🔴 이 코드는 **사용자의 저장소에서 데이터를 지운다.** 그래서 테스트가 지키는 것은 하나다:
 *    **손댄 것은 절대 지우지 않는다.** 우리가 심었다는 이유로 사용자가 고쳐 쓰는 값을 지우면
 *    그건 남의 설정을 지우는 것이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { removeLegacySeeds } from '../src/lib/seedCleanup.js';

function installStorage(seed = {}) {
  const store = { ...seed };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => {
          Object.assign(store, items);
        },
        remove: async (key) => {
          delete store[key];
        },
      },
    },
    runtime: {},
  };
  return store;
}

const SEEDED_GLOSSARY = [
  { id: 'gl-1', sourceText: '배포', targetText: 'rollout', keepSource: false },
  { id: 'gl-2', sourceText: '사이', targetText: 'Sai', keepSource: true },
  { id: 'gl-3', sourceText: '기획서', targetText: 'product spec', keepSource: false },
  { id: 'gl-4', sourceText: '갈아엎다', targetText: 'rework from scratch', keepSource: false },
];

const SEEDED_RECIPIENTS = [
  { id: 'rc-miguel', name: 'Miguel', timeZone: 'Europe/Berlin', tagIds: ['prefers-direct'] },
  { id: 'rc-sarah', name: 'Sarah', timeZone: 'America/New_York', tagIds: ['prefers-short'] },
];

test('심어져 있던 용어 4건·수신자 2명을 지운다', async () => {
  const store = installStorage({
    'sai.glossary.personal': [...SEEDED_GLOSSARY],
    'sai.recipients': [...SEEDED_RECIPIENTS],
  });
  const removed = await removeLegacySeeds();
  assert.deepEqual(removed, { glossary: 4, recipients: 2 });
  assert.deepEqual(store['sai.glossary.personal'], []);
  assert.deepEqual(store['sai.recipients'], []);
});

test('🔴 사용자가 고친 것은 지우지 않는다 — id가 같아도 내용이 다르면 그건 사용자 데이터다', async () => {
  const store = installStorage({
    'sai.glossary.personal': [
      { id: 'gl-1', sourceText: '배포', targetText: 'deploy', keepSource: false }, // 번역어를 고침
      { id: 'gl-3', sourceText: '기획서', targetText: 'product spec', keepSource: false }, // 그대로
    ],
    'sai.recipients': [
      { id: 'rc-miguel', name: 'Miguel', timeZone: 'Asia/Seoul' }, // 타임존을 고침
    ],
  });
  const removed = await removeLegacySeeds();
  assert.deepEqual(removed, { glossary: 1, recipients: 0 });
  assert.deepEqual(
    store['sai.glossary.personal'].map((e) => e.id),
    ['gl-1'],
    '고친 항목이 사라졌다',
  );
  assert.equal(store['sai.recipients'].length, 1);
});

test('🔴 사용자가 직접 넣은 항목은 건드리지 않는다', async () => {
  const mine = [
    { id: 'gl-abc123', sourceText: '배포', targetText: 'rollout', keepSource: false },
  ];
  const store = installStorage({ 'sai.glossary.personal': mine });
  const removed = await removeLegacySeeds();
  assert.equal(removed.glossary, 0, '내용이 같아도 id가 우리 시드가 아니면 남긴다');
  assert.deepEqual(store['sai.glossary.personal'], mine);
});

test('🔴 한 번만 돈다 — 지운 뒤 다시 등록한 것을 또 지우면 안 된다', async () => {
  const store = installStorage({ 'sai.glossary.personal': [...SEEDED_GLOSSARY] });
  await removeLegacySeeds();

  // 사용자가 같은 값을 **직접** 다시 넣었다고 하자(우연히 id까지 같다면 최악의 경우다).
  store['sai.glossary.personal'] = [...SEEDED_GLOSSARY];
  const second = await removeLegacySeeds();
  assert.deepEqual(second, { glossary: 0, recipients: 0 });
  assert.equal(store['sai.glossary.personal'].length, 4);
});

test('저장된 적 없는 상태에서도 죽지 않는다', async () => {
  installStorage();
  assert.deepEqual(await removeLegacySeeds(), { glossary: 0, recipients: 0 });
});

test('🔴 플래그 말고는 아무것도 새로 저장하지 않는다', async () => {
  const store = installStorage();
  await removeLegacySeeds();
  assert.deepEqual(Object.keys(store), ['sai.seedCleanup.v1']);
});
