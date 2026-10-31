/**
 * 품질 모드 표 (2026-10-30) — `src/core/refine/quality.js`.
 * 🔴 확장은 이름만, 모델은 서버 표. 표 밖 값은 기본 모드. anthropic 단계에만 적용.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUALITY, QUALITY_IDS, QUALITY_MODES, qualityStepDeps, resolveQuality } from '../src/core/refine/quality.js';
import { EFFORT_LEVELS, effortValue } from '../src/core/refine/providers/anthropic.js';
import { DISPLAY_SETTINGS, coerceDisplayValue } from '../src/lib/displaySettings.js';

test('모드는 빠른·기본·심층 세 개이고 기본값은 표 안에 있다', () => {
  assert.deepEqual(QUALITY_IDS, ['fast', 'standard', 'deep']);
  assert.ok(QUALITY_IDS.includes(DEFAULT_QUALITY));
});

test('🔴 표의 모든 줄은 Claude 모델·허용된 사고·effort만 쓴다', () => {
  for (const [id, row] of Object.entries(QUALITY_MODES)) {
    assert.match(row.model, /^claude-/, id);
    assert.ok(['disabled', 'adaptive', 'between_tools'].includes(row.thinking), `${id} thinking`);
    assert.ok(EFFORT_LEVELS.includes(row.effort), `${id} effort`);
    assert.ok(Number.isInteger(row.timeoutMs) && row.timeoutMs > 0 && row.timeoutMs <= 60_000, `${id} timeout`);
    // Sonnet 5.5는 disabled가 400, Opus 5.5는 사고를 끌 수 없다(모델 문서).
    if (row.model.startsWith('claude-sonnet-5-5')) assert.notEqual(row.thinking, 'disabled', `${id}: Sonnet 5.5 disabled는 400`);
    if (row.model.startsWith('claude-opus-5-5')) assert.equal(row.thinking, 'adaptive', `${id}: Opus 5.5는 adaptive만`);
    if (row.thinking === 'between_tools') assert.notEqual(row.effort, 'max', `${id}: between_tools는 high 이하`);
  }
});

test('🔴 resolveQuality — 표 밖 값·모델명·타입 오류는 기본 모드', () => {
  for (const id of QUALITY_IDS) assert.equal(resolveQuality(id), id);
  for (const bad of [undefined, null, '', 'turbo', 'claude-opus-5-5', 'DEEP', 1, {}, '__proto__', 'toString']) {
    assert.equal(resolveQuality(bad), DEFAULT_QUALITY, String(bad));
  }
});

test('qualityStepDeps — anthropic에만 값을 주고, 다른 provider는 빈 객체', () => {
  assert.deepEqual(qualityStepDeps('deep', 'groq'), {});
  assert.deepEqual(qualityStepDeps('deep', 'gemini'), {});
  const { model, thinking, effort, timeoutMs } = QUALITY_MODES.deep;
  assert.deepEqual(qualityStepDeps('deep', 'anthropic'), { model, thinking, effort, timeoutMs });
  assert.deepEqual(qualityStepDeps('nope', 'anthropic').model, QUALITY_MODES[DEFAULT_QUALITY].model);
});

test('effortValue — 표 밖·없음은 low(오타가 지연을 늘리지 않게)', () => {
  for (const e of EFFORT_LEVELS) assert.equal(effortValue(e), e);
  for (const bad of [undefined, 'max', 'xhigh', 'HIGH', 3]) assert.equal(effortValue(bad), 'low');
});

test('설정 저장값 — 품질 모드는 표의 이름만 받고 나머지는 기본 모드', () => {
  assert.equal(DISPLAY_SETTINGS.quality.fallback, DEFAULT_QUALITY);
  assert.equal(coerceDisplayValue('quality', 'deep'), 'deep');
  assert.equal(coerceDisplayValue('quality', 'claude-opus-5-5'), DEFAULT_QUALITY);
});

test('🔴 2026-10-31 월 $100 예산 — 기본값은 빠른, 상위 모드 하루 기본 10·심층 3, 낮춤 문구는 네 사유(plan — 2026-10-31 결제)', async () => {
  const { PREMIUM_DAILY_LIMITS, QUALITY_DOWNGRADE_NOTES } = await import('../src/core/refine/quality.js');
  assert.equal(DEFAULT_QUALITY, 'fast');
  assert.deepEqual({ ...PREMIUM_DAILY_LIMITS }, { standard: 10, deep: 3 });
  assert.deepEqual(Object.keys(QUALITY_DOWNGRADE_NOTES).sort(), ['budget', 'daily', 'plan', 'unavailable']);
});
