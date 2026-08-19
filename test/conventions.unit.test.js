/**
 * 언어권 어법 관습 (Spec 필수 2 3순위 / 2026-08-16).
 *
 * 🔴 이 테스트의 **핵심은 하나**다: 규칙이 **사람에 대한 단정**을 담지 않는다.
 *    필수 9 G1/G2 · CLAUDE.md 최상단(국가 단위 단정 금지) · Lessons #7(EU AI Act).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { conventionRules, CONVENTION_LANGUAGES } from '../src/core/refine/conventions.js';

test('지원 언어는 어법 노트를 낸다', () => {
  for (const code of CONVENTION_LANGUAGES) {
    const rules = conventionRules(code);
    assert.notEqual(rules, '', `${code}: 노트가 비었다`);
  }
});

test('🔴 모르는 언어는 빈 문자열이다 — 검증되지 않은 규칙을 지어내지 않는다', () => {
  assert.equal(conventionRules('xx'), '');
  assert.equal(conventionRules(undefined), '');
});

test('🔴 국적·국민을 주어로 쓰는 문장이 없다 (필수 9 G1/G2 · Lessons #7)', () => {
  const banned = [
    /\b(americans?|chinese people|japanese people|germans?|french people|koreans?)\b/i,
    /\bpeople (in|from) \w+ (are|tend)/i,
    /\bthis culture\b/i,
  ];
  for (const code of CONVENTION_LANGUAGES) {
    const rules = conventionRules(code);
    for (const pattern of banned) {
      assert.ok(!pattern.test(rules), `${code}: 사람에 대한 단정이 있다 — ${pattern}`);
    }
  }
});

test('🔴 3순위임을 지시문이 스스로 밝힌다 — 1·2순위와 충돌하면 진다', () => {
  const rules = conventionRules('en');
  assert.match(rules, /rank 3|lowest priority/i);
  assert.match(rules, /rank BELOW/i);
});

test('🔴 사실·기한·숫자를 바꾸지 말라는 금지가 함께 실린다', () => {
  assert.match(conventionRules('ja'), /never change facts, deadlines, numbers/i);
});

test('🔴 수신자 개인에 대한 추론을 금지한다 — "이 사람은 이 나라 사람이니까"가 필수 9 위반이다', () => {
  assert.match(conventionRules('zh'), /not.*claims about people|must not infer/i);
});

test('영어 노트가 완곡 요청을 다룬다 — 이 제품의 핵심 실패(F-11)와 같은 축이다', () => {
  assert.match(conventionRules('en'), /I was wondering if/);
});

/* ── 🔴 화면과 서버의 언어 집합이 어긋나지 않는다 (2026-08-16 실측이 잡은 결함) ───── */

import { RECIPIENT_LANGUAGES } from '../src/lib/recipients.js';
import { refine } from '../src/core/refine/index.js';

test('🔴 수신자가 고를 수 있는 언어는 서버가 전부 받는다 — 어긋나면 그 수신자는 교정이 통째로 실패한다', async () => {
  for (const code of RECIPIENT_LANGUAGES) {
    // 언어 검증만 확인한다 — 키가 없으므로 그 뒤 단계에서 다른 이유로 실패하는 것은 상관없다.
    await refine(
      { text: '확인 부탁드립니다', sourceLanguage: 'ko', targetLanguage: code },
      { apiKey: null },
    ).catch((error) => {
      assert.ok(
        !String(error?.message ?? '').includes('targetLanguage must be one of'),
        `${code}: 서버가 거절한다`,
      );
    });
  }
});
