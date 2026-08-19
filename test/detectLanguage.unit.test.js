/**
 * 원문 언어 추정 (2026-08-20 — 「한글 아니면 전부 영어」가 만든 조용한 오작동을 잠근다).
 *
 * 🔴 이 테스트가 지키는 것: **일본어를 중국어로 판정하지 않는 것**(가나 우선)과
 *    **모르는 문자를 지어내지 않는 것**(지원 목록 밖은 en).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectLanguage, DETECTABLE_LANGUAGES } from '../src/lib/detectLanguage.js';

test('한글이 있으면 ko', () => {
  assert.equal(detectLanguage('배포 계획을 확인해 주세요'), 'ko');
  assert.equal(detectLanguage('ㅋㅋ 확인했어요'), 'ko');
  // 영문이 섞여도 한글이 있으면 한국어다 — 업무 메시지에 영어 고유명사가 흔하다.
  assert.equal(detectLanguage('PR #482 리뷰 부탁드려요'), 'ko');
});

test('🔴 가나가 있으면 ja — 한자가 섞여 있어도 중국어가 아니다', () => {
  assert.equal(detectLanguage('デプロイ計画を確認してください'), 'ja', '한자에 끌려 zh가 됐다');
  assert.equal(detectLanguage('ありがとうございます'), 'ja');
  assert.equal(detectLanguage('リリースは金曜日です'), 'ja');
});

test('가나 없이 한자만이면 zh', () => {
  assert.equal(detectLanguage('请确认部署计划'), 'zh');
  assert.equal(detectLanguage('发布日程'), 'zh');
});

test('라틴 문자는 en — de·fr·es를 문자로 가르지 않는다(틀리면 조용히 틀린다)', () => {
  assert.equal(detectLanguage('Please review the deployment plan'), 'en');
  assert.equal(detectLanguage('Bitte prüfen Sie den Plan'), 'en');
  assert.equal(detectLanguage('¿Puedes revisar el plan?'), 'en');
});

test('🔴 지원하지 않는 문자는 지어내지 않고 en으로 — 러시아어를 ru로 보내면 서버가 400을 낸다', () => {
  assert.equal(detectLanguage('Пожалуйста, проверьте план'), 'en');
  assert.equal(detectLanguage('الرجاء مراجعة الخطة'), 'en');
});

test('빈 값·null에도 죽지 않는다', () => {
  assert.equal(detectLanguage(''), 'en');
  assert.equal(detectLanguage(null), 'en');
  assert.equal(detectLanguage(undefined), 'en');
});

test('🔴 판정 결과는 항상 지원 목록 안에 있다', () => {
  const samples = ['안녕하세요', 'デプロイ', '部署计划', 'Hello', 'Привет', '', '123 456'];
  for (const sample of samples) {
    assert.ok(
      DETECTABLE_LANGUAGES.includes(detectLanguage(sample)),
      `목록 밖 값이 나왔다: ${detectLanguage(sample)}`,
    );
  }
});
