/**
 * 이름·호칭 보존 검사 (2026-08-16 사용자 요청).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 실측 결함 두 가지를 잡는다 — 이름이 **사라진** 경우와 **없는 호칭으로 바뀐** 경우.
 *    ② **멀쩡한 문장을 잡지 않는다** — 오탐이 잦으면 경고 자체를 안 읽게 된다.
 *    ③ 원문에 없던 이름은 검사하지 않는다(다른 사람 얘기일 수 있다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkNamesPreserved, nameWarningText } from '../src/core/refine/names.js';

test('🔴 실측 ① — 이름이 통째로 사라지면 잡는다 (독일어)', () => {
  const { dropped } = checkNamesPreserved({
    sourceText: '싱싱님, 배포는 오늘까지 해야 합니다.',
    refined: 'Der Rollout muss unbedingt heute erfolgen.',
    names: ['싱싱'],
  });
  assert.deepEqual(dropped, ['싱싱']);
});

test('🔴 실측 ② — 없는 한자 이름·호칭을 만들어내면 잡는다 (중국어)', () => {
  const { dropped } = checkNamesPreserved({
    sourceText: '싱싱님, 안녕하세요.',
    refined: '上晦先生/女士，您好。',
    names: ['싱싱'],
  });
  assert.deepEqual(dropped, ['싱싱']);
});

test('이름이 그대로 남아 있으면 조용하다', () => {
  const { dropped } = checkNamesPreserved({
    sourceText: '싱싱님, 안녕하세요.',
    refined: '싱싱님, 안녕하세요. 배포 일정을 조율하고 싶습니다.',
    names: ['싱싱'],
  });
  assert.deepEqual(dropped, []);
});

test('등록 표기에 호칭이 붙어 있어도 이름만으로 확인한다', () => {
  const { dropped } = checkNamesPreserved({
    sourceText: '싱싱님께 전달 부탁드려요.',
    refined: 'Please pass this along to 싱싱.',
    names: ['싱싱님'],
  });
  assert.deepEqual(dropped, [], '호칭 접미사 때문에 멀쩡한 문장을 잡았다');
});

test('🔴 원문에 없던 이름은 검사하지 않는다', () => {
  const { dropped } = checkNamesPreserved({
    sourceText: '배포 일정을 조율하고 싶어요.',
    refined: 'I would like to coordinate the release schedule.',
    names: ['싱싱'],
  });
  assert.deepEqual(dropped, [], '원문에 없던 이름을 사라졌다고 말했다');
});

test('🔴 한 글자 이름은 검사하지 않는다 — 아무 문장에나 우연히 걸린다', () => {
  const { dropped } = checkNamesPreserved({
    sourceText: '김 부장님께 보고했습니다.',
    refined: 'I reported it to the director.',
    names: ['김'],
  });
  assert.deepEqual(dropped, []);
});

test('🔴 원문이나 교정문이 비면 판정하지 않는다', () => {
  assert.deepEqual(checkNamesPreserved({ sourceText: '', refined: 'x', names: ['싱싱'] }).dropped, []);
  assert.deepEqual(checkNamesPreserved({ sourceText: '싱싱님', refined: '', names: ['싱싱'] }).dropped, []);
});

test('경고 문구는 단정하지 않는다 — 사라졌는지 바뀌었는지 우리는 모른다', () => {
  const text = nameWarningText(['싱싱']);
  assert.match(text, /싱싱/);
  assert.match(text, /빠졌거나 다른 표기로 바뀌었을/);
  assert.equal(nameWarningText([]), '');
});
