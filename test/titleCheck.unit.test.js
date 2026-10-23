/**
 * L32 — 등록되지 않은 사람의 직급 지어내기 검사 (2026-10-23).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 실측 결함을 잡는다 — 운영 Gemini 2회: 「박 과장님」 → "Manager Park".
 *    ② **멀쩡한 결과를 잡지 않는다** — 등록된 사람 · Mr. Park · Park 혼자 · 「박 과장님」 그대로 ·
 *       다른 성 · 영어 원문 · 폴백 · 떨어진 직급("the manager, Park,"). 오탐이 잦으면 경고를 흘려본다(S42·S44).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkInventedTitles,
  findInventedTitles,
  findTitledReferences,
  inventedTitleWarningText,
} from '../src/core/refine/titleCheck.js';

const SOURCE = '박 과장님이 오늘 오후에 배포 결과를 확인해야 합니다.';
const REAL_1 =
  'Could you please check the deployment results by this afternoon, as Manager Park needs to review them?';
const REAL_2 = 'Manager Park needs to check the deployment results this afternoon.';

const koEn = (refined, extra = {}) => ({
  refined,
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  appliedGlossary: [],
  ...extra,
});

// ── ① 실측 결함 ──────────────────────────────────────────────────────────
test('🔴 실측 1 — "…as Manager Park needs to review them?"를 잡는다', () => {
  const out = checkInventedTitles(koEn(REAL_1), SOURCE);
  assert.deepEqual(out, [{ original: '박 과장님', produced: 'Manager Park' }]);
});

test('🔴 실측 2 — "Manager Park needs to check…"를 잡고 문구에 두 표기가 다 나온다', () => {
  const out = checkInventedTitles(koEn(REAL_2), SOURCE);
  assert.deepEqual(out, [{ original: '박 과장님', produced: 'Manager Park' }]);
  const text = inventedTitleWarningText(out);
  assert.match(text, /직급을 지어냈을 수 있어요 — "Manager Park"\(원문 「박 과장님」\)/);
  assert.match(text, /용어집에 등록하면/);
});

test('여러 단어 직급어·로마자 변형·붙여 쓴 원문·이름 포함도 잡는다', () => {
  assert.deepEqual(
    findInventedTitles({ sourceText: '정차장님께 보고했습니다.', refined: 'I reported it to Deputy General Manager Jeong.' }),
    [{ original: '정차장님', produced: 'Deputy General Manager Jeong' }],
  );
  assert.deepEqual(
    findInventedTitles({ sourceText: '이 팀장님 확인 부탁드립니다.', refined: 'Please get confirmation from team lead Lee.' }),
    [{ original: '이 팀장님', produced: 'team lead Lee' }],
  );
  assert.deepEqual(
    findInventedTitles({ sourceText: '박수홍 과장님이 맡습니다.', refined: 'Manager Su-hong Park will handle it.' }),
    [{ original: '박수홍 과장님', produced: 'Manager Su-hong Park' }],
  );
  assert.deepEqual(
    findInventedTitles({ sourceText: '김 대리가 할 거예요.', refined: 'Assistant Manager Kim will do it.' }),
    [{ original: '김 대리', produced: 'Assistant Manager Kim' }],
  );
});

// ── ② 오탐 방지 ──────────────────────────────────────────────────────────
test('등록된 사람(honorifics.ko·matchedInOriginal) — 등록 호칭으로 바뀐 것은 정당하다', () => {
  const person = {
    id: 'p1',
    entryType: 'person',
    sourceText: '박수홍',
    honorifics: { ko: '박 과장님', en: 'Manager Park' },
    matchedInOriginal: '박 과장님',
  };
  assert.deepEqual(checkInventedTitles(koEn(REAL_2), SOURCE, { glossary: [person] }), []);
});

test('등록된 출력값과 같으면 통과 — 원문 쪽 표기가 달라도(honorifics.en)', () => {
  const person = { entryType: 'person', sourceText: '박수홍', honorifics: { en: 'Manager Park' } };
  assert.deepEqual(checkInventedTitles(koEn(REAL_2), SOURCE, { glossary: [person] }), []);
});

test('모델이 appliedGlossary에 신고했으면 통과 (화면이 모르는 팀 항목)', () => {
  const result = koEn(REAL_2, {
    appliedGlossary: [{ id: 't1', sourceText: '박 과장님', appliedText: 'Manager Park' }],
  });
  assert.deepEqual(checkInventedTitles(result, SOURCE), []);
});

test('용어 항목 「과장 → Manager」 — 사용자가 정한 번역이라 통과', () => {
  const term = { entryType: 'term', sourceText: '과장', targetText: 'Manager' };
  assert.deepEqual(checkInventedTitles(koEn(REAL_2), SOURCE, { glossary: [term] }), []);
});

test('"Mr. Park"·"Ms. Park" — 일반 경칭은 직급이 아니다', () => {
  assert.deepEqual(checkInventedTitles(koEn('Mr. Park needs to check the results.'), SOURCE), []);
  assert.deepEqual(checkInventedTitles(koEn('Ms. Park needs to check the results.'), SOURCE), []);
});

test('"Park" 혼자 · 「박 과장님」 그대로 — 경고 없음', () => {
  assert.deepEqual(checkInventedTitles(koEn('Park needs to check the results.'), SOURCE), []);
  assert.deepEqual(checkInventedTitles(koEn('박 과장님 needs to check the results.'), SOURCE), []);
});

test('다른 성 — 원문 「김 과장님」인데 "Manager Park"은 이 검사의 대상이 아니다', () => {
  assert.deepEqual(
    checkInventedTitles(koEn(REAL_2), '김 과장님이 오늘 확인해야 합니다.'),
    [],
  );
});

test('떨어진 직급 — "the manager, Park," · "Park, our manager" 는 잡지 않는다(헤더 판정표 행 7)', () => {
  assert.deepEqual(checkInventedTitles(koEn('The manager, Park, needs to check it.'), SOURCE), []);
  assert.deepEqual(checkInventedTitles(koEn('Park, our manager, needs to check it.'), SOURCE), []);
});

test('소문자 "park" — 낱말(공원)이라 잡지 않는다', () => {
  assert.deepEqual(checkInventedTitles(koEn('The manager will walk in the park.'), SOURCE), []);
});

test('영어 원문 · 영어 외 대상 · 폴백 · 결과 없음 — 판정하지 않는다', () => {
  assert.deepEqual(checkInventedTitles({ ...koEn(REAL_2), sourceLanguage: 'en' }, SOURCE), []);
  assert.deepEqual(checkInventedTitles({ ...koEn(REAL_2), targetLanguage: 'de' }, SOURCE), []);
  assert.deepEqual(checkInventedTitles({ ...koEn(REAL_2), fallback: true }, SOURCE), []);
  assert.deepEqual(checkInventedTitles(null, SOURCE), []);
  assert.equal(inventedTitleWarningText([]), '');
});

test('원문 참조 — 낱말 중간의 성·직급은 참조가 아니다(「대박 과장님」·「박 과장급」)', () => {
  assert.deepEqual(findTitledReferences('대박 과장님 최고'), []);
  assert.deepEqual(findTitledReferences('박 과장급 인원'), []);
  assert.deepEqual(findTitledReferences('박 과장이 왔다'), [{ reference: '박 과장', surname: '박' }]);
});

test('원문에 영어로 "Manager Park"을 이미 썼으면 잡지 않는다', () => {
  assert.deepEqual(
    findInventedTitles({ sourceText: '박 과장님(Manager Park)이 확인합니다.', refined: REAL_2 }),
    [],
  );
});
