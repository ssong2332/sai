/**
 * 「기본 톤」 ↔ 「협업 성향」 한 번 맞추기 (`src/lib/toneReconcile.js`, 2026-10-25 — 화면에 보이는 값이 이긴다).
 *
 * 🔴 판정표 행마다 하나씩 + 저장소 실행(프로필만 바뀌고 온보딩은 그대로, 멱등) + background 연결.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { reconcileToneProfile, runToneReconcile } from '../src/lib/toneReconcile.js';
import { DEFAULT_TONES } from '../src/lib/onboarding.js';
import { clearAllLocal, getLocal, setLocal, STORAGE_KEYS } from '../src/lib/storage.js';

beforeEach(async () => {
  await clearAllLocal();
});

test('행 1 — 유효한 톤 + 다른 협업 성향 → 톤으로 맞춘다', () => {
  assert.deepEqual(reconcileToneProfile({ tone: 'warm' }, { collabStyleId: 'brief' }), { collabStyleId: 'warm' });
});

test('행 1 — 유효한 톤 + 협업 성향 없음(null·없음·프로필 없음) → 톤으로 채운다', () => {
  assert.deepEqual(reconcileToneProfile({ tone: 'direct' }, { collabStyleId: null }), { collabStyleId: 'direct' });
  assert.deepEqual(reconcileToneProfile({ tone: 'direct' }, { situationId: 'incident' }), { collabStyleId: 'direct' });
  assert.deepEqual(reconcileToneProfile({ tone: 'direct' }, null), { collabStyleId: 'direct' });
});

test('행 2 — 유효한 톤 + 같은 값 → 할 일 없음', () => {
  for (const { id } of DEFAULT_TONES) {
    assert.equal(reconcileToneProfile({ tone: id }, { collabStyleId: id }), null, id);
  }
});

test('행 3 — 톤이 비었거나 목록 밖 → 건드리지 않는다', () => {
  for (const tone of [null, undefined, '', 'shouty', 3, {}]) {
    assert.equal(reconcileToneProfile({ tone }, { collabStyleId: 'brief' }), null, String(tone));
    assert.equal(reconcileToneProfile({ tone }, { collabStyleId: null }), null, String(tone));
  }
  assert.equal(reconcileToneProfile(null, { collabStyleId: 'brief' }), null);
  assert.equal(reconcileToneProfile(undefined, undefined), null);
});

test('🔴 실행 — 프로필만 고치고 온보딩·상황은 그대로, 두 번 돌려도 같다', async () => {
  const onboarding = { language: 'ko', partnerRegion: 'english', tone: 'rationale', completedAt: '2026-10-01T00:00:00.000Z' };
  await setLocal(STORAGE_KEYS.ONBOARDING, onboarding);
  await setLocal(STORAGE_KEYS.PROFILE, { situationId: 'incident', collabStyleId: 'brief' });

  assert.equal(await runToneReconcile(), true);
  assert.deepEqual(await getLocal(STORAGE_KEYS.PROFILE), { situationId: 'incident', collabStyleId: 'rationale' });
  assert.deepEqual(await getLocal(STORAGE_KEYS.ONBOARDING), onboarding, '온보딩은 쓰지 않는다');

  assert.equal(await runToneReconcile(), false, '멱등');
  assert.deepEqual(await getLocal(STORAGE_KEYS.PROFILE), { situationId: 'incident', collabStyleId: 'rationale' });
});

test('🔴 실행 — 톤이 없으면 협업 성향을 그대로 둔다', async () => {
  await setLocal(STORAGE_KEYS.PROFILE, { situationId: null, collabStyleId: 'brief' });
  assert.equal(await runToneReconcile(), false);
  assert.deepEqual(await getLocal(STORAGE_KEYS.PROFILE), { situationId: null, collabStyleId: 'brief' });
});

test('🔴 background — 설치·업데이트 때 한 번 돈다', () => {
  const bg = readFileSync(new URL('../src/background/index.js', import.meta.url), 'utf8');
  assert.ok(bg.includes("import { runToneReconcile } from '../lib/toneReconcile.js';"));
  assert.match(bg, /chrome\.runtime\.onInstalled\.addListener\(\(\) => \{\s*runToneReconcile\(\)\.catch\(\(\) => \{\}\);\s*\}\);/);
});
