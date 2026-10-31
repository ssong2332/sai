/**
 * 제3자 이름 빠짐 검사 (L28 ①, 2026-10-31) — `src/core/refine/nameLossCheck.js` 판정표.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkLostNames, findLostNames, lostNameWarningText } from '../src/core/refine/nameLossCheck.js';

const SRC = '박 과장님이 오늘 오후에 배포 결과를 확인해야 합니다.';
const LOST_REFINED = 'Could you check the deployment results this afternoon?';
const LOST_BACK = '오늘 오후에 배포 결과를 확인해 주실 수 있나요?';

test('🔴 실측 2026-10-29 — 「박 과장님」이 교정문·역번역 둘 다에서 사라지면 경고', () => {
  const lost = findLostNames({ sourceText: SRC, refined: LOST_REFINED, backTranslation: LOST_BACK });
  assert.deepEqual(lost, [{ reference: '박 과장님' }]);
  assert.match(lostNameWarningText(lost), /「박 과장님」/);
});

test('판정표 4 — 교정문에 로마자(Park·Pak·Bak)나 한글 참조가 남으면 경고 없음', () => {
  for (const refined of [
    'Mr. Park needs to check the deployment results this afternoon.',
    'Park will review the deployment results this afternoon.',
    'Bak needs to check it.',
    '박 과장님 needs to check it.',
  ]) {
    assert.deepEqual(findLostNames({ sourceText: SRC, refined, backTranslation: LOST_BACK }), [], refined);
  }
});

test('판정표 4 — 소문자 park(공원)은 이름으로 치지 않는다', () => {
  const refined = 'Could you check the park deployment results this afternoon?';
  assert.deepEqual(findLostNames({ sourceText: SRC, refined, backTranslation: LOST_BACK }), [{ reference: '박 과장님' }]);
});

test('판정표 5 — 역번역에 성이 낱말 첫 글자로 남으면 경고 없음(로마자 표 밖 표기 대비)', () => {
  const refined = 'Could you ask Pahk to check the results?';
  for (const backTranslation of ['박 과장님께 결과 확인을 부탁해 주실 수 있나요?', '박수홍 님께 확인을 부탁해 주세요.']) {
    assert.deepEqual(findLostNames({ sourceText: SRC, refined, backTranslation }), [], backTranslation);
  }
});

test('판정표 5 — 낱말 중간의 성 글자(「대박」)는 흔적으로 치지 않는다', () => {
  const back = '대박이네요, 오늘 오후에 배포 결과를 확인해 주실 수 있나요?';
  assert.deepEqual(findLostNames({ sourceText: SRC, refined: LOST_REFINED, backTranslation: back }), [{ reference: '박 과장님' }]);
});

test('판정표 3 — 받는 사람 본인이거나 용어집 항목이면 경고 없음', () => {
  assert.deepEqual(
    findLostNames({ sourceText: SRC, refined: LOST_REFINED, backTranslation: LOST_BACK, recipientNames: ['박 과장님'] }),
    [],
  );
  assert.deepEqual(
    findLostNames({
      sourceText: SRC,
      refined: LOST_REFINED,
      backTranslation: LOST_BACK,
      glossary: [{ sourceText: '박 과장님', targetText: 'Sam' }],
    }),
    [],
  );
});

test('판정표 2 — 「성 + 직급」이 없는 원문은 대상이 아니다', () => {
  for (const sourceText of ['수진 씨가 확인해야 합니다.', '대박 과장급 이슈입니다.', '오늘 오후에 확인하겠습니다.']) {
    assert.deepEqual(findLostNames({ sourceText, refined: LOST_REFINED, backTranslation: LOST_BACK }), [], sourceText);
  }
});

test('판정표 1 — 폴백·영어 원문·영어 아닌 대상 언어는 검사하지 않는다', () => {
  const base = { refined: LOST_REFINED, backTranslation: LOST_BACK, sourceLanguage: 'ko', targetLanguage: 'en' };
  assert.equal(checkLostNames(base, SRC).length, 1);
  assert.deepEqual(checkLostNames({ ...base, fallback: true }, SRC), []);
  assert.deepEqual(checkLostNames({ ...base, sourceLanguage: 'en' }, SRC), []);
  assert.deepEqual(checkLostNames({ ...base, targetLanguage: 'ja' }, SRC), []);
  assert.deepEqual(checkLostNames(null, SRC), []);
});
