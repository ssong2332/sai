/**
 * 결제 시작 클라이언트 (2026-10-31, `src/lib/billingClient.js`) — 요금제 이름·주기만 보내고, 사유 코드를 화면 문구로.
 * 🔴 네트워크 없음: fetch는 가짜. 로그인 토큰은 authClient를 흉내 낸 저장값으로.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FEATURES } from '../src/config.js';
import { BILLING_ERRORS, billingErrorText, getMyPlan, planBadgeLabel, planSummary, startCheckout } from '../src/lib/billingClient.js';
import { QUALITY_DOWNGRADE_NOTES } from '../src/core/refine/quality.js';

test('🔴 공개 빌드에서 결제 진입점은 꺼져 있다(실판매 전 — 샌드박스에 연결됨)', () => {
  assert.equal(FEATURES.billing, false);
});

test('모르는 주기는 서버를 부르지 않고 거절', async () => {
  let called = false;
  await assert.rejects(
    () => startCheckout('week', { fetchImpl: async () => { called = true; return new globalThis.Response('{}'); } }),
    (e) => e.reason === BILLING_ERRORS.UNKNOWN,
  );
  assert.equal(called, false);
});

test('사유 코드마다 화면 문구가 있다 · 무료 요금제 낮춤 문구', () => {
  for (const reason of Object.values(BILLING_ERRORS)) assert.ok(billingErrorText(reason).length > 0, reason);
  assert.match(QUALITY_DOWNGRADE_NOTES.plan, /무료 요금제/);
});

test('로고 옆 배지 — 결제한 요금제(pro·team)만 글자, 그 밖은 배지 없음', () => {
  assert.equal(planBadgeLabel('pro'), 'PRO');
  assert.equal(planBadgeLabel('team'), 'TEAM');
  for (const plan of ['free', 'beta', null, undefined, 'x']) assert.equal(planBadgeLabel(plan), null, String(plan));
});

test('내 요금제 — 로그인 안 했으면 서버를 부르지 않고 null(배지 없음)', async () => {
  let called = false;
  const plan = await getMyPlan({ fetchImpl: async () => { called = true; return new globalThis.Response('{"plan":"pro"}'); } });
  assert.equal(plan, null);
  assert.equal(called, false);
});

test('설정 「지금 플랜」 — 결제한 요금제는 그 이름·한도(PLAN_LIMITS), 베타·모름은 null(출시 기간 문구 그대로)', () => {
  assert.deepEqual([planSummary('team').name, planSummary('team').daily], ['팀 요금제', '200회 · 기본 20 · 심층 5']);
  assert.deepEqual([planSummary('pro').name, planSummary('pro').daily], ['Pro', '200회 · 기본 10 · 심층 3']);
  assert.deepEqual([planSummary('free').name, planSummary('free').daily], ['무료', '20회 · 빠른 모드만']);
  for (const plan of ['beta', null, undefined, 'x']) assert.equal(planSummary(plan), null, String(plan));
});
