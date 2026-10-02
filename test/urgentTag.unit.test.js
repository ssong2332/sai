/**
 * `[🚨 URGENT]` 태그와 학습 판정 (2026-10-02 버그 수정).
 * 🔴 지키는 것: 태그만 붙은 적용은 «고친 것»이 아니다 — 「이번 수정은 학습되지 않았어요」가 뜨면 안 된다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URGENT_PREFIX, withUrgentPrefix, stripUrgentPrefix, editedTextForLearning } from '../src/content/urgentTag.js';

const AI = 'Please verify the deployment by tomorrow. This is urgent.';

test('🔴 태그만 붙인 적용은 고친 게 아니다 — 학습하지 않는다', () => {
  assert.equal(editedTextForLearning(AI, withUrgentPrefix(AI)), null);
});

test('그대로 적용해도 고친 게 아니다', () => {
  assert.equal(editedTextForLearning(AI, AI), null);
});

test('🔴 태그 + 실제 수정이면 태그를 뗀 문장으로 학습한다', () => {
  const edited = 'Please verify the deployment by tomorrow.';
  assert.equal(editedTextForLearning(AI, withUrgentPrefix(edited)), edited);
});

test('태그는 두 번 붙지 않고, 떼면 원문이다', () => {
  assert.equal(withUrgentPrefix(withUrgentPrefix(AI)), `${URGENT_PREFIX}${AI}`);
  assert.equal(stripUrgentPrefix(withUrgentPrefix(AI)), AI);
});

test('교정 경로가 아니면(aiText 없음) 학습하지 않는다', () => {
  assert.equal(editedTextForLearning(null, 'ticket text'), null);
});

test('🔴 팝업이 태그를 자체 정의하지 않는다 — 규칙은 urgentTag.js 한 곳', () => {
  const popup = readFileSync(new URL('../src/content/RefinePopup.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(popup, /const URGENT_PREFIX\s*=/);
  const overlay = readFileSync(new URL('../src/content/SaiOverlay.jsx', import.meta.url), 'utf8');
  assert.match(overlay, /editedTextForLearning\(aiText, text\)/);
});
