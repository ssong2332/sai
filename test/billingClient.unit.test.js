/**
 * 결제 시작 클라이언트 (2026-10-31, `src/lib/billingClient.js`) — 요금제 이름·주기만 보내고, 사유 코드를 화면 문구로.
 * 🔴 네트워크 없음: fetch는 가짜. 로그인 토큰은 authClient를 흉내 낸 저장값으로.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FEATURES } from '../src/config.js';
import { BILLING_ERRORS, billingErrorText, startCheckout } from '../src/lib/billingClient.js';
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
