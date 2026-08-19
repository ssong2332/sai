/**
 * 캐주얼 톤 계약 (Spec 권장 4). 2026-08-18 신설.
 *
 * 🔴 **왜 생겼나.** 캐주얼 토글도 **사실상 효과가 없었다** — 켜고 끈 결과가 `it` ↔ `this` 한 글자
 *    차이였고, 실려 보낸 승인 표현 6개가 **하나도 쓰이지 않았다**(2026-08-18 실측).
 *    긴급도(`urgencyTone.unit.test.js`)와 **원인이 똑같았다**:
 *      ① 규칙이 `directionRules`(「완충 표현 금지 · 일관된 격식 유지」)보다 **앞**에 있어 졌다.
 *      ② 문구가 방어적이라(“안 맞으면 하나도 쓰지 마라”) 모델에게 **아무것도 안 하기**가 가장
 *         안전한 선택이었다.
 *    두 결함 다 빌드·`no-undef`·기존 테스트 어디에도 걸리지 않았다. 그래서 여기서 직접 대조한다.
 *
 * 🔴 **밈 강제로 가지 않는다.** 표현을 억지로 끼워 넣으면 업무 메시지가 망가진다 — 그 방어는
 *    옳았고 유지된다. 아래 테스트가 그 방어까지 함께 지킨다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRefinePayload } from '../src/core/refine/prompt.js';
import { buildCasualToneBlock } from '../src/core/meme/index.js';

const BASE = {
  text: '배포 일정을 조율해야 합니다.',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-18',
};
const instructionFor = (casual) =>
  buildRefinePayload({ ...BASE, casualTone: casual ? buildCasualToneBlock('en', true) : null })
    .instruction;

test('🔴 캐주얼 ON/OFF의 지시문이 다르다 — 같으면 토글이 화면에만 있는 것이다', () => {
  assert.notEqual(instructionFor(true), instructionFor(false));
});

test('꺼져 있으면 캐주얼 지시가 아예 실리지 않는다', () => {
  assert.doesNotMatch(instructionFor(false), /REGISTER: the user turned ON/);
});

test('🔴 «무엇을 바꿀지»가 구체적으로 적혀 있다 — "lighter register" 한마디로는 안 바뀐다', () => {
  const on = instructionFor(true);
  assert.match(on, /contractions/, '축약형 지시가 없다');
  assert.match(on, /keep\s+sentences short/, '짧은 문장 지시가 없다');
  assert.match(on, /Please be advised/, '버릴 상투구 예시가 없다');
});

test('🔴 앞선 「격식 유지」 지시를 넘어선다고 **명시**한다', () => {
  // 이 한 문장이 없으면 directionRules의 격식 유지가 이긴다 — 그것이 원인 ①이었다.
  assert.match(instructionFor(true), /THIS OVERRIDES the general instruction/);
});

test('🔴 캐주얼 규칙이 「완충/격식」 금지 **뒤**에 온다 — 배치가 곧 우선순위다', () => {
  const on = instructionFor(true);
  const banAt = on.indexOf('Do NOT add softening hedges');
  const casualAt = on.indexOf('REGISTER: the user turned ON');
  assert.ok(banAt >= 0 && casualAt >= 0, '테스트가 낡았다 — 두 지점을 못 찾았다');
  assert.ok(casualAt > banAt, '캐주얼이 금지보다 앞에 있다 — 금지가 이겨서 토글이 무효가 된다');
});

test('🔴 긴급도가 캐주얼보다 **뒤**에 온다 — 마감의 틀은 긴급도가 마지막 말을 갖는다', () => {
  const on = buildRefinePayload({
    ...BASE,
    userUrgency: 'CRITICAL',
    casualTone: buildCasualToneBlock('en', true),
  }).instruction;
  assert.ok(
    on.indexOf('URGENCY LEVEL CHOSEN BY THE USER') > on.indexOf('REGISTER: the user turned ON'),
    '캐주얼이 긴급도보다 뒤다 — 긴급 메시지가 가벼운 문체에 눌릴 수 있다',
  );
});

test('🔴 표현을 강제하지 않는다 — 밈을 억지로 끼우면 업무 메시지가 망가진다', () => {
  const on = instructionFor(true);
  assert.match(on, /never force one in/, '억지 삽입 금지가 사라졌다');
  assert.match(on, /using none of them is fine/, '"하나도 안 써도 된다"가 사라졌다');
  assert.match(on, /Do NOT invent slang/, '지어내기 금지가 사라졌다');
});

test('🔴 캐주얼이어도 사실은 안 바뀐다', () => {
  assert.match(
    instructionFor(true),
    /NOT drop or soften any deadline, number, or required action/,
    '캐주얼이 마감을 흐릴 수 있는 상태다',
  );
});

test('🔴 국가·국민성에 표현을 결부하지 않는다 (Spec 필수 9)', () => {
  assert.match(instructionFor(true), /Do not attach any expression to a nationality or country/);
});
