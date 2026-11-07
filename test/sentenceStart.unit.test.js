/**
 * 교정문 첫 글자 대문자 보정 (2026-11-07 K9, `src/core/refine/sentenceStart.js` 판정표).
 * 🔴 실측: 빠른 모드 독일어 「vielen Dank für …」(4회 중 3회).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { capitalizeSentenceStart } from '../src/core/refine/sentenceStart.js';

test('🔴 실측 K9 — 독일어 소문자 시작을 첫 글자만 대문자로', () => {
  assert.equal(
    capitalizeSentenceStart('vielen Dank für die Unterlagen.', 'de', '자료 잘 받았습니다.'),
    'Vielen Dank für die Unterlagen.',
  );
});

test('en·fr·es도 같은 규칙 · 스페인어 여는 물음표 뒤 글자', () => {
  assert.equal(capitalizeSentenceStart('thank you for the update.', 'en', '공유 감사합니다'), 'Thank you for the update.');
  assert.equal(capitalizeSentenceStart('merci pour votre retour.', 'fr', '감사합니다'), 'Merci pour votre retour.');
  assert.equal(capitalizeSentenceStart('¿podrían enviarlo hoy?', 'es', '오늘 보내 주실 수 있나요?'), '¿Podrían enviarlo hoy?');
  assert.equal(capitalizeSentenceStart('  «bonjour», merci', 'fr', ''), '  «Bonjour», merci');
});

test('이미 대문자·라틴 문자권 아님은 그대로', () => {
  assert.equal(capitalizeSentenceStart('Vielen Dank.', 'de', ''), 'Vielen Dank.');
  assert.equal(capitalizeSentenceStart('ありがとうございます。', 'ja', ''), 'ありがとうございます。');
  assert.equal(capitalizeSentenceStart('vielen dank', 'ko', ''), 'vielen dank');
});

test('🔴 브랜드·주소·코드·원문 그대로 둔 소문자 단어는 건드리지 않는다', () => {
  assert.equal(capitalizeSentenceStart('iPhone 17 is ready.', 'en', ''), 'iPhone 17 is ready.');
  assert.equal(capitalizeSentenceStart('eBay listing is live.', 'en', ''), 'eBay listing is live.');
  assert.equal(capitalizeSentenceStart('www.example.com ist online.', 'de', ''), 'www.example.com ist online.');
  assert.equal(capitalizeSentenceStart('v2.1 is deployed.', 'en', ''), 'v2.1 is deployed.');
  assert.equal(capitalizeSentenceStart('npm install failed.', 'en', 'npm install이 실패했어요'), 'npm install failed.');
});

test('빈 값·문자열 아님은 그대로 (던지지 않는다)', () => {
  assert.equal(capitalizeSentenceStart('', 'de', ''), '');
  assert.equal(capitalizeSentenceStart(null, 'de', ''), null);
  assert.equal(capitalizeSentenceStart('123 Stück', 'de', ''), '123 Stück');
});
