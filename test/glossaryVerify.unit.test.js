/**
 * `core/refine/glossaryVerify.js` — 용어집 「적용됨」을 등록된 말로 판정한다 (2026-11-02).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { activeGlossaryEntries, countMissingGlossary, reconcileAppliedGlossary, withGlossaryReminder } from '../src/core/refine/glossaryVerify.js';

const team = (sourceText, targetText, extra = {}) => ({ id: `t-${sourceText}-${targetText}`, entryType: 'term', scope: 'team', sourceText, targetText, keepSource: false, ...extra });
const personal = (sourceText, targetText) => ({ ...team(sourceText, targetText), id: `p-${sourceText}`, scope: 'personal' });

test('원문에 나온 용어만 — 조사가 붙어도 걸린다', () => {
  const active = activeGlossaryEntries([team('배포', 'ABC'), team('정산', 'settlement')], '배포가 밀렸습니다.');
  assert.deepEqual(active.map((e) => e.sourceText), ['배포']);
});

test('같은 원문이면 개인이 팀을 이긴다 — 순서와 상관없이', () => {
  const active = activeGlossaryEntries([team('배포', 'ABC'), personal('배포', 'release')], '배포 일정');
  assert.equal(active.length, 1);
  assert.equal(active[0].targetText, 'release');
});

test('keepSource는 원문 그대로가 등록된 말이다', () => {
  const glossary = [team('Sai', null, { keepSource: true })];
  assert.equal(countMissingGlossary('Sai will ship today.', glossary, 'Sai 출시'), 0);
  assert.equal(countMissingGlossary('We will ship today.', glossary, 'Sai 출시'), 1);
});

test('번역어도 원문 유지도 없는 항목은 대조하지 않는다', () => {
  assert.equal(countMissingGlossary('anything', [team('배포', '')], '배포'), 0);
});

test('대소문자는 무시한다', () => {
  assert.equal(countMissingGlossary('the abc schedule', [team('배포', 'ABC')], '배포 일정'), 0);
});

test('reconcile — 모델 신고(deployment)를 등록된 말(ABC)로 바꾸고, 모르는 id는 뺀다', () => {
  const result = { refined: 'The deployment slipped.', appliedGlossary: [{ id: 'x', sourceText: '배포', appliedText: 'deployment' }] };
  const out = reconcileAppliedGlossary(result, [team('배포', 'ABC')], '배포가 밀렸다');
  assert.deepEqual(out.appliedGlossary, [{ id: 't-배포-ABC', sourceText: '배포', appliedText: 'ABC' }]);
  assert.equal(result.appliedGlossary[0].appliedText, 'deployment', '입력을 고치지 않는다');
});

test('reconcile — 용어집이 없으면 그대로 둔다', () => {
  const result = { appliedGlossary: [{ id: 'x', appliedText: 'y' }] };
  assert.equal(reconcileAppliedGlossary(result, [], '원문'), result);
});

test('withGlossaryReminder — 빠진 항목이 없으면 payload를 그대로 돌려준다', () => {
  const payload = { instruction: 'x' };
  assert.equal(withGlossaryReminder(payload, []), payload);
});

test('withGlossaryReminder — instruction 끝에 쌍을 JSON 문자열로 붙이고, 다른 필드는 건드리지 않는다', () => {
  const payload = { instruction: 'base', text: '원문' };
  const out = withGlossaryReminder(payload, [team('배포', 'ABC'), team('Sai', null, { keepSource: true })]);
  assert.ok(out.instruction.startsWith('base RETRY NOTE'));
  assert.ok(out.instruction.includes('"배포" -> "ABC"'));
  assert.ok(out.instruction.includes('"Sai" -> "Sai"'));
  assert.equal(out.text, '원문');
  assert.equal(payload.instruction, 'base');
});

/* ── 횟수 (2026-11-02 — 원문 두 곳 중 한 곳만 바뀌어도 통과했다) ── */

import { countOccurrences, missingGlossaryEntries } from '../src/core/refine/glossaryVerify.js';
import { checkGlossaryApplied, glossaryPartialText } from '../src/core/refine/glossaryCheck.js';

test('countOccurrences — 겹치지 않게 세고, 대소문자·공백을 무시하고, 빈 값은 0', () => {
  assert.equal(countOccurrences('배포', '배포 일정이 … 금요일 배포 전에'), 2);
  assert.equal(countOccurrences('abc', 'The ABC schedule … the Friday ABC'), 2);
  assert.equal(countOccurrences('aa', 'aaaa'), 2);
  assert.equal(countOccurrences('', 'x'), 0);
});

test('원문 두 곳인데 교정문 한 곳이면 빠진 것으로 본다(재호출 대상)', () => {
  const g = [team('배포', 'ABC')];
  const src = '배포 일정이 밀렸습니다. 금요일 배포 전에 QA 부탁드립니다.';
  assert.equal(missingGlossaryEntries('The ABC schedule slipped. QA before the Friday release?', g, src).length, 1);
  assert.equal(missingGlossaryEntries('The ABC schedule slipped. QA before the Friday ABC?', g, src).length, 0);
});

test('화면 — 일부만이면 적용됨·초록은 그대로, partial에 횟수를 담는다', () => {
  const result = { refined: 'The ABC schedule slipped. QA before the Friday release?', appliedGlossary: [{ id: 't1', sourceText: '배포', appliedText: 'ABC' }] };
  const check = checkGlossaryApplied(result, '배포 일정이 밀렸습니다. 금요일 배포 전에');
  assert.equal(check.applied.length, 1);
  assert.deepEqual(check.partial, [{ appliedText: 'ABC', inSource: 2, inRefined: 1 }]);
  assert.ok(glossaryPartialText(check.partial).includes('「ABC」 원문 2곳 중 1곳'));
});

test('화면 — 원문을 모르면 일부만 판정을 하지 않는다(예전 동작)', () => {
  const result = { refined: 'The ABC slipped.', appliedGlossary: [{ id: 't1', sourceText: '배포', appliedText: 'ABC' }] };
  assert.deepEqual(checkGlossaryApplied(result).partial, []);
});
