/**
 * `GET /health` 응답 (L13 — 2026-09-30).
 *
 * 🔴 이 테스트가 지키는 것: ① `availableProviders`가 **등록된 시크릿**을 따른다(하드코딩 금지)
 *    ② 키 **값**이 응답 어디에도 나가지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { healthPayload } from '../functions/health.js';

const OPENAI = 'sk-test-openai-value-should-never-leak';
const GEMINI = 'gemini-test-value-should-never-leak';

test('🔴 두 시크릿이 다 있으면 둘 다 보고한다 — 예전 하드코딩은 openai를 빠뜨렸다', () => {
  const body = healthPayload({ selected: { provider: 'openai' }, keys: { openai: OPENAI, gemini: GEMINI } });
  assert.deepEqual(body, { ok: true, provider: 'openai', availableProviders: ['openai', 'gemini'], configured: true });
});

test('gemini만 있으면 gemini만', () => {
  const body = healthPayload({ selected: { provider: 'gemini' }, keys: { openai: null, gemini: GEMINI } });
  assert.deepEqual(body.availableProviders, ['gemini']);
  assert.equal(body.provider, 'gemini');
});

test('아무 시크릿도 없으면 비어 있고 configured=false', () => {
  const body = healthPayload({ selected: null, keys: { openai: null, gemini: null } });
  assert.deepEqual(body, { ok: true, provider: null, availableProviders: [], configured: false });
});

test('🔴 키 값이 응답에 나가지 않는다', () => {
  const text = JSON.stringify(
    healthPayload({ selected: { provider: 'openai', apiKey: OPENAI }, keys: { openai: OPENAI, gemini: GEMINI } }),
  );
  assert.equal(text.includes(OPENAI), false);
  assert.equal(text.includes(GEMINI), false);
});
