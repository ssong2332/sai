/**
 * 사람 용어집 원문 일치 — 코드가 먼저 판정한다 (refine-v22, L30 N-02).
 *
 * 🔴 지키는 것: ① 등록된 원문 언어 호칭이 원문에 **그대로** 있으면 일치(실명이 없어도)
 *    ② 성씨·직급 일부만 같으면 일치가 아니다 — 동명이인에게 남의 호칭을 붙이지 않는다
 *    ③ 용어(term)·불일치 엔트리는 원본 그대로 ④ payload와 지시문이 표시된 목록을 쓴다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { annotateGlossaryMatches, buildRefinePayload } from '../src/core/refine/prompt.js';

const PERSON = { id: 'g2', entryType: 'person', scope: 'personal', sourceText: '김수진', honorifics: { ko: '김 대리님', en: 'Sujin Kim' } };
const TERM = { id: 'g1', entryType: 'term', scope: 'personal', sourceText: 'Nexus', targetText: null, keepSource: true };

test('등록 호칭이 원문에 그대로 있으면 일치 — 실명이 없어도', () => {
  const [entry] = annotateGlossaryMatches([PERSON], '김 대리님이 확인해 주셔야 합니다.', 'ko');
  assert.equal(entry.matchedInOriginal, '김 대리님');
});

test('실명이 있어도 일치', () => {
  const [entry] = annotateGlossaryMatches([PERSON], '김수진 님께 전달 부탁드립니다.', 'ko');
  assert.equal(entry.matchedInOriginal, '김수진');
});

test('🔴 성씨·직급 일부만 같으면 일치가 아니다 — 동명이인에게 남의 호칭을 붙이지 않는다', () => {
  for (const text of ['김 과장님이 확인해 주셔야 합니다.', '대리님이 확인해 주세요.', '김 팀장님께 여쭤볼게요.']) {
    const [entry] = annotateGlossaryMatches([PERSON], text, 'ko');
    assert.equal('matchedInOriginal' in entry, false, text);
    assert.equal(entry, PERSON, '불일치 엔트리는 원본 객체 그대로');
  }
});

test('용어(term) 엔트리는 손대지 않는다', () => {
  const [entry] = annotateGlossaryMatches([TERM], 'Nexus 배포 완료', 'ko');
  assert.equal(entry, TERM);
});

test('원문 언어 호칭이 없으면(다른 언어만 등록) 실명으로만 본다', () => {
  const enOnly = { ...PERSON, honorifics: { en: 'Sujin Kim' } };
  const [entry] = annotateGlossaryMatches([enOnly], '김 대리님이 확인해 주셔야 합니다.', 'ko');
  assert.equal('matchedInOriginal' in entry, false);
});

test('payload의 glossary와 지시문이 표시된 목록을 쓴다', () => {
  const payload = buildRefinePayload({
    text: '김 대리님이 확인해 주셔야 합니다.',
    sourceLanguage: 'ko',
    targetLanguage: 'en',
    glossary: [PERSON, TERM],
    referenceDate: '2026-08-12',
  });
  assert.equal(payload.glossary[0].matchedInOriginal, '김 대리님');
  assert.equal('matchedInOriginal' in payload.glossary[1], false);
  assert.match(payload.instruction, /matchedInOriginal/);
});
