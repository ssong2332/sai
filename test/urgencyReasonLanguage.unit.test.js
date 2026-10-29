/**
 * 「AI 판정 근거」 언어 계약. 2026-10-29 신설.
 *
 * 🔴 한국어 근거에 영어 단어 `routine`이 섞여 나왔다(실확장 화면). 긴급도 정의 문장의
 *    `routine deadline`을 모델이 옮긴 것으로 본다(추정). 지시문 단어를 근거에 옮기지 말라는
 *    문장이 프롬프트에서 빠지면 여기서 실패한다. 🔴 모델이 실제로 따르는지는 이 테스트가 아니라
 *    실 API 확인으로만 알 수 있다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRefinePayload } from '../src/core/refine/prompt.js';

const instruction = buildRefinePayload({
  text: '배포 일정을 조율해야 합니다.',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-10-29',
}).instruction;

test('근거는 입력 언어로만 쓰고 지시문 영어 단어를 옮기지 않는다', () => {
  assert.match(instruction, /Write that sentence entirely in the input language/);
  assert.match(instruction, /do not carry English words from these instructions \(such as "routine"/);
});

test('원문에서 인용한 이름·용어는 그대로 둘 수 있다', () => {
  assert.match(instruction, /only names or terms quoted from the original text may stay as written/);
});
