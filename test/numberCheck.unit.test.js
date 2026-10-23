/**
 * 숫자 보존 검사 (L31, 2026-10-23).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 실측 결함을 잡는다 — 회귀(L30 ④)에서 영어 교정문이 `200ms`를 빠뜨렸다(P-04·D-05).
 *    ② **멀쩡한 번역을 잡지 않는다** — 단위·쉼표·만/천·날짜 표기가 바뀌는 건 정상이다.
 *       오탐이 잦으면 경고 자체를 안 읽게 된다(S42·S44).
 *    ③ 폴백 결과는 검사하지 않는다 — 대조할 교정문이 없다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkNumbersPreserved,
  findDroppedNumbers,
  numberWarningText,
} from '../src/core/refine/numberCheck.js';
import { findUnverifiedSpecifics } from '../src/core/reply/verify.js';

const KO_EN = { sourceLanguage: 'ko', targetLanguage: 'en' };
const EN_KO = { sourceLanguage: 'en', targetLanguage: 'ko' };

function dropped(sourceText, refined, langs = KO_EN) {
  return findDroppedNumbers({ sourceText, refined, ...langs });
}

// ── ① 실측 결함 ─────────────────────────────────────────────────────────
test('🔴 실측 P-04 — 「200ms」가 빠지면 잡는다 (3초는 남음)', () => {
  assert.deepEqual(
    dropped(
      '서버 응답이 평소 200ms에서 3초로 늘었습니다. 원인 확인이 필요합니다.',
      'Server response time has increased to 3 seconds. We need to identify the cause.',
    ),
    ['200ms'],
  );
});

test('🔴 실측 D-05 — 숫자가 하나뿐인 문장에서 빠져도 잡는다', () => {
  assert.deepEqual(dropped('응답 시간이 200ms입니다.', 'The response time is fast.'), ['200ms']);
});

test('🔴 실측 P-04 반대쪽 — 「3초」가 빠지면 잡는다', () => {
  assert.deepEqual(
    dropped('서버 응답이 평소 200ms에서 3초로 늘었습니다.', 'Server response time increased from 200ms.'),
    ['3초'],
  );
});

test('영어 원문 → 한국어 교정문에서 빠진 숫자도 잡는다', () => {
  assert.deepEqual(
    dropped('Latency went from 200ms to 3 seconds after the deploy.', '배포 후 지연 시간이 3초로 늘었습니다.', EN_KO),
    ['200ms'],
  );
});

test('여러 개가 빠지면 원문 순서대로 모두, 중복 없이', () => {
  assert.deepEqual(
    dropped('5명이 30%를 처리했고, 5명이 남았습니다.', 'Some people handled part of it, and the rest remain.'),
    ['5명', '30%'],
  );
});

// ── ② 멀쩡한 번역은 조용하다 ──────────────────────────────────────────────
test('숫자가 그대로 있으면 빈 목록', () => {
  assert.deepEqual(
    dropped(
      '서버 응답이 평소 200ms에서 3초로 늘었습니다.',
      'Server response time increased from 200ms to 3s.',
    ),
    [],
  );
});

test('「3초」 → 「3 seconds」는 누락이 아니다', () => {
  assert.deepEqual(dropped('3초 안에 응답해야 합니다.', 'It must respond within 3 seconds.'), []);
});

test('「3초」 → 「three seconds」(풀어 쓴 수)도 누락이 아니다', () => {
  assert.deepEqual(dropped('3초 안에 응답해야 합니다.', 'It must respond within three seconds.'), []);
});

test('「200ms」 → 「0.2 seconds」(단위 환산)는 누락이 아니다', () => {
  assert.deepEqual(dropped('응답 시간이 200ms입니다.', 'The response time is 0.2 seconds.'), []);
});

test('「3,000만원」 → 「30,000,000」·「30 million」·「3천만 원」 모두 누락이 아니다', () => {
  const src = '예산은 3,000만원입니다.';
  assert.deepEqual(dropped(src, 'The budget is KRW 30,000,000.'), []);
  assert.deepEqual(dropped(src, 'The budget is 30 million won.'), []);
  assert.deepEqual(dropped(src, 'The budget is KRW 30M.'), []);
  assert.deepEqual(dropped(src, '예산은 3천만 원입니다.', { sourceLanguage: 'ko', targetLanguage: 'ko' }), []);
});

test('「5천만원에서 3천만원」 → 「50 million … 30 million」 (P-05)', () => {
  assert.deepEqual(
    dropped(
      '예산이 5천만원에서 3천만원으로 줄었습니다.',
      'The budget has been reduced from KRW 50 million to KRW 30 million.',
    ),
    [],
  );
});

test('한국어 복합 수 「3억 5천만원」 → 「350 million」', () => {
  assert.deepEqual(dropped('매출은 3억 5천만원입니다.', 'Revenue is KRW 350 million.'), []);
});

test('복수형·외국어 배수 — 「1억 2천만원」 → 「120 millions」(불), 「24시」 → 「midnight」', () => {
  assert.deepEqual(
    dropped('예산은 1억 2천만원입니다.', 'Le budget est de 120 millions de wons.', { sourceLanguage: 'ko', targetLanguage: 'fr' }),
    [],
  );
  assert.deepEqual(dropped('오늘 24시까지 보내 주세요.', 'Please send it by midnight today.'), []);
});

test('쉼표 묶음은 같은 값 — 「3,000」 ↔ 「3000」 ↔ 「3.000」(독일식)', () => {
  assert.deepEqual(dropped('3,000건을 처리했습니다.', 'We processed 3000 cases.'), []);
  assert.deepEqual(dropped('3000건을 처리했습니다.', 'We processed 3,000 cases.'), []);
  assert.deepEqual(
    dropped('3,000건을 처리했습니다.', 'Wir haben 3.000 Fälle bearbeitet.', { sourceLanguage: 'ko', targetLanguage: 'de' }),
    [],
  );
});

test('🔴 쉼표 묶음을 쪼개지 않는다 — 「3,000」이 빠지면 「3」·「000」이 아니라 「3,000건」 하나', () => {
  assert.deepEqual(dropped('3,000건을 처리했습니다.', 'We processed many cases.'), ['3,000건']);
});

test('날짜 「8/4」 → 「Aug 4, 2026」·「August 4」는 누락이 아니다', () => {
  assert.deepEqual(dropped('8/4까지 보내 주세요.', 'Please send it by Aug 4, 2026.'), []);
  assert.deepEqual(dropped('8/4까지 보내 주세요.', 'Please send it by August 4.'), []);
});

test('날짜가 바뀌면 잡는다 — 「8/4」 → 「Aug 5」', () => {
  assert.deepEqual(dropped('8/4까지 보내 주세요.', 'Please send it by Aug 5.'), ['8/4']);
});

test('「08월 18일」 → 「August 18」 — 앞자리 0이 부스러기로 남지 않는다', () => {
  assert.deepEqual(dropped('08월 18일에 배포합니다.', 'We will deploy on August 18.'), []);
});

test('시각 「14:00」·「14시」 → 「2 PM」, 「오후 2시」 → 「14:00」', () => {
  assert.deepEqual(dropped('14:00에 회의합니다.', "Let's meet at 2 PM."), []);
  assert.deepEqual(dropped('14시에 회의합니다.', "Let's meet at 2 p.m."), []);
  assert.deepEqual(dropped('오후 2시에 회의합니다.', "Let's meet at 14:00."), []);
});

test('줄머리 목록 번호는 검사하지 않는다 — 글머리표로 바뀌어도 정상', () => {
  assert.deepEqual(
    dropped('1. 로그 확인\n2. 재배포\n3. 모니터링', '- Check the logs\n- Redeploy\n- Monitor'),
    [],
  );
});

test('값 1과 기간 복합(「1시간 30분」)은 검사하지 않는다', () => {
  assert.deepEqual(dropped('1시간 30분 걸립니다.', 'It takes an hour and a half.'), []);
  assert.deepEqual(dropped('회의를 1개 잡겠습니다.', "I'll set up a meeting."), []);
});

test('한국어 교정문의 고유어 수 — 「3 options」 → 「세 가지 선택지」', () => {
  assert.deepEqual(dropped('We have 3 options.', '선택지가 세 가지 있습니다.', EN_KO), []);
});

test('중국어 교정문의 한자 수 — 「3초」 → 「三秒」', () => {
  assert.deepEqual(
    dropped('3초 안에 응답해야 합니다.', '必须在三秒内响应。', { sourceLanguage: 'ko', targetLanguage: 'zh' }),
    [],
  );
});

test('둘 중 하나라도 비면 판정하지 않는다', () => {
  assert.deepEqual(dropped('', 'anything 3'), []);
  assert.deepEqual(dropped('200ms', ''), []);
});

// ── ③ 화면 진입점 ────────────────────────────────────────────────────────
test('🔴 폴백 결과는 검사하지 않는다', () => {
  const result = { fallback: true, refined: '원문 그대로', sourceLanguage: 'ko', targetLanguage: 'en' };
  assert.deepEqual(checkNumbersPreserved(result, '응답 시간이 200ms입니다.'), []);
});

test('정상 결과는 result의 언어로 검사한다', () => {
  const result = { refined: 'The response time is fast.', sourceLanguage: 'ko', targetLanguage: 'en' };
  assert.deepEqual(checkNumbersPreserved(result, '응답 시간이 200ms입니다.'), ['200ms']);
  assert.deepEqual(checkNumbersPreserved(null, '200ms'), []);
});

test('화면 문구는 값을 「」로 묶고, 비면 빈 문자열', () => {
  assert.equal(numberWarningText([]), '');
  assert.match(numberWarningText(['200ms', '3초']), /「200ms」, 「3초」/);
});

// ── verify.js와 같은 숫자 규칙을 쓴다(동작 무변경 확인) ───────────────────
test('verify.js 동작 무변경 — 내보내기 추가 후에도 「482」가 「2」를 가리지 않는다', () => {
  assert.deepEqual(findUnverifiedSpecifics('2pm에 가능합니다.', 'PR #482 리뷰 부탁드립니다.'), ['2']);
});
