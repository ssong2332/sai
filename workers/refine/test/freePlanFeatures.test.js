/**
 * 무료 요금제 2단계(2026-11-05 사용자 결정 「B안 — 개인 용어집 5 · 저장 문구 3 · 회신 하루 3」) — 서버 쪽.
 * 🔴 네트워크 없음: Claude·Firestore 모두 가짜. 표는 `src/core/refine/quality.js` `PLAN_FEATURES` 한 곳.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { PLAN_FEATURES, featuresFor } from '../../../src/core/refine/quality.js';
import { applyPlanFeatures, createHandler } from '../src/handler.js';
import { createMemoryUsageStore } from '../src/usageStore.js';
import { BASE_BODY, TEST_ENV, captureLogger, fakeAnthropicFetch, makeKeys, refineRequest, signIdToken } from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);
const UID = 'uid-test-123';
const ENFORCED = { ...TEST_ENV, BILLING_ENFORCED: '1' };

function setup(usageStore = createMemoryUsageStore()) {
  return createHandler({ jwks: keys.jwks, fetchImpl: fakeAnthropicFetch(), usageStore, cache: new MemoryCacheStore(), logger: captureLogger() });
}

const replyBody = (i) => ({ ...BASE_BODY, mode: 'reply', intent: 'accept', answers: [], text: `Can you review this by Friday? ${i}` });

test('표 — 무료는 회신 3 · 개인 용어 5 · 저장 문구 3 · 예약/학습 끔, 모르는 요금제는 무료(잠그는 쪽), 나머지는 제한 없음', () => {
  assert.deepEqual(PLAN_FEATURES.free, { replyDaily: 3, personalGlossary: 5, snippets: 3, scheduling: false, learning: false });
  for (const plan of ['beta', 'pro', 'team']) {
    assert.deepEqual(featuresFor(plan), { replyDaily: null, personalGlossary: null, snippets: null, scheduling: true, learning: true }, plan);
  }
  for (const plan of [undefined, null, 'x']) assert.equal(featuresFor(plan), PLAN_FEATURES.free, String(plan));
});

test('회신 초안 — 무료는 하루 3회, 4번째 429 reply-limit · Pro는 제한 없음 · 다듬기는 회신 한도와 상관없음', async () => {
  const free = setup();
  for (let i = 0; i < 3; i += 1) assert.notEqual((await free(refineRequest(token, replyBody(i)), ENFORCED)).status, 429, `회신 ${i + 1}`);
  const fourth = await free(refineRequest(token, replyBody(3)), ENFORCED);
  assert.deepEqual([fourth.status, (await fourth.json()).error], [429, 'reply-limit']);
  const refine = await free(refineRequest(token, { ...BASE_BODY, text: `${BASE_BODY.text} 다음` }), ENFORCED);
  assert.equal(refine.status, 200, '다듬기는 계속 된다');

  const proStore = createMemoryUsageStore();
  proStore.setBilling(UID, { status: 'active', provider: 'groble', plan: 'pro' });
  const pro = setup(proStore);
  for (let i = 0; i < 5; i += 1) assert.notEqual((await pro(refineRequest(token, replyBody(i)), ENFORCED)).status, 429, `Pro 회신 ${i + 1}`);
});

test('요청 정리 — 무료는 개인 용어 앞 5개만(팀 용어는 그대로) · 학습 기록 비움(1순위 설정은 남김) · 유료는 그대로', () => {
  const personal = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, scope: 'personal', sourceText: `p${i}`, targetText: `P${i}` }));
  const teamTerms = [{ id: 't1', scope: 'team', sourceText: 't', targetText: 'T' }];
  const make = () => ({
    glossary: [...personal.slice(0, 3), teamTerms[0], ...personal.slice(3)],
    profile: { situation: 'client', collabStyle: 'direct', learned: [{ id: 'tone' }] },
  });

  const freeBody = applyPlanFeatures(make(), featuresFor('free'));
  assert.deepEqual(freeBody.glossary.map((e) => e.id), ['p0', 'p1', 'p2', 't1', 'p3', 'p4']);
  assert.deepEqual(freeBody.profile, { situation: 'client', collabStyle: 'direct', learned: [] });

  const proBody = applyPlanFeatures(make(), featuresFor('pro'));
  assert.equal(proBody.glossary.length, 8);
  assert.deepEqual(proBody.profile.learned, [{ id: 'tone' }]);
  assert.deepEqual(applyPlanFeatures({ text: 'x' }, featuresFor('free')), { text: 'x' }, '필드가 없으면 건드리지 않는다');
});
