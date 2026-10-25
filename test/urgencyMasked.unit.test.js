/**
 * 다듬기 쪽 `urgencyGap` 판정 (2026-10-25). 옛 조건은 항상 거짓이라 이 지표가 0건이었다 —
 * 실제 schema 정규화 결과를 그대로 넣어 「세는 경우가 실제로 생긴다」를 잠근다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isUrgencyMasked } from '../src/lib/friction.js';
import { normalizeRefineResponse } from '../src/core/refine/schema.js';

const norm = (aiUrgency, userUrgency) =>
  normalizeRefineResponse({ urgency: aiUrgency, refined: 'x', backTranslation: 'y' }, { userUrgency }).result;

test('사용자가 CRITICAL로 골랐는데 글은 LOW로 읽힌다 → 센다', () => {
  assert.equal(isUrgencyMasked(norm('LOW', 'CRITICAL')), true);
  assert.equal(isUrgencyMasked(norm('NORMAL', 'CRITICAL')), true);
  assert.equal(isUrgencyMasked(norm('LOW', 'NORMAL')), true);
});

test('사용자 선택이 AI 판정과 같거나 낮다 → 세지 않는다', () => {
  assert.equal(isUrgencyMasked(norm('CRITICAL', 'CRITICAL')), false);
  assert.equal(isUrgencyMasked(norm('CRITICAL', 'LOW')), false);
});

test('사용자가 고르지 않았거나 폴백·AI 판정 없음 → 세지 않는다', () => {
  assert.equal(isUrgencyMasked(norm('CRITICAL', null)), false);
  assert.equal(isUrgencyMasked(norm(undefined, 'CRITICAL')), false);
  assert.equal(isUrgencyMasked({ ...norm('LOW', 'CRITICAL'), fallback: true }), false);
  assert.equal(isUrgencyMasked(null), false);
});
