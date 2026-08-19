/**
 * 역번역 실패 감지 (2026-08-16 사용자 승인 ⓑ) · 언어별 캐주얼 톤 보장.
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 실측한 실패 두 가지를 잡는다 — 교정문이 그대로 돌아온 경우, 내 언어가 아닌 경우.
 *    ② **멀쩡한 역번역을 지우지 않는다.** 오탐이 나면 정상 기능이 매번 사라진다.
 *    ③ 같은 언어쌍(ko→ko)에서는 아예 판정하지 않는다 — 그때는 같은 게 정상이다.
 *    ④ **지원하는 모든 언어에 캐주얼 표현이 있다.** 4개 언어가 통째로 비어 토글이 무동작이던
 *       사고를 두 번 겪지 않기 위한 계약이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkBackTranslation,
  backFailMessage,
  isExplanationReadable,
  BACK_FAIL,
} from '../src/core/refine/backcheck.js';
import { buildCasualToneBlock } from '../src/core/meme/index.js';
import { RECIPIENT_LANGUAGES } from '../src/lib/recipients.js';

/* ── ⓑ 역번역 검사 ────────────────────────────────────────────────────── */

test('🔴 실측 — 교정문이 그대로 돌아오면 못 쓴다', () => {
  const same = '싱싱님，您好。我想协调一下发布日程。';
  const out = checkBackTranslation({
    backTranslation: same,
    refined: same,
    sourceLanguage: 'ko',
    targetLanguage: 'zh',
  });
  assert.equal(out.usable, false);
  assert.equal(out.reason, BACK_FAIL.SAME_AS_REFINED);
});

test('🔴 실측 — 역번역이 내 언어(한글)가 아니면 못 쓴다', () => {
  const out = checkBackTranslation({
    backTranslation: '您好。我想协调一下发布日程，方便吗？',
    refined: '您好。我想协调发布日程。',
    sourceLanguage: 'ko',
    targetLanguage: 'zh',
  });
  assert.equal(out.usable, false);
  assert.equal(out.reason, BACK_FAIL.WRONG_SCRIPT);
});

test('정상 역번역은 그대로 통과한다', () => {
  const out = checkBackTranslation({
    backTranslation: '안녕하세요. 배포 일정을 조율하고 싶습니다.',
    refined: '您好。我想协调一下发布日程。',
    sourceLanguage: 'ko',
    targetLanguage: 'zh',
  });
  assert.equal(out.usable, true);
  assert.equal(out.reason, null);
});

test('🔴 용어가 원문 언어로 남아 있어도 한글이 있으면 통과한다', () => {
  // 실측 화면: 「오늘의 rollout(배포)는 반드시 완료해 주시기 바랍니다」
  const out = checkBackTranslation({
    backTranslation: '오늘의 rollout는 반드시 완료해 주시기 바랍니다. product spec도 확인 부탁드립니다.',
    refined: '今天的 rollout 务必完成。',
    sourceLanguage: 'ko',
    targetLanguage: 'zh',
  });
  assert.equal(out.usable, true, '용어가 영어로 남았다고 멀쩡한 역번역을 지웠다');
});

test('🔴 같은 언어쌍에서는 판정하지 않는다 — 같은 게 정상이다', () => {
  const same = '배포 일정을 조율하고 싶습니다.';
  const out = checkBackTranslation({
    backTranslation: same,
    refined: same,
    sourceLanguage: 'ko',
    targetLanguage: 'ko',
  });
  assert.equal(out.usable, true);
});

test('🔴 라틴 문자권끼리는 문자 검사를 하지 않는다 — 구분할 수 없다', () => {
  // 영어 사용자가 독일어로 보낼 때. 역번역이 정말 영어인지 문자로는 알 수 없으므로 통과시킨다.
  const out = checkBackTranslation({
    backTranslation: 'Please complete the rollout today.',
    refined: 'Der Rollout muss heute erfolgen.',
    sourceLanguage: 'en',
    targetLanguage: 'de',
  });
  assert.equal(out.usable, true);
});

test('구두점만 다르면 「같다」로 본다', () => {
  const out = checkBackTranslation({
    backTranslation: '您好，我想协调发布日程。',
    refined: '您好 我想协调发布日程',
    sourceLanguage: 'ko',
    targetLanguage: 'zh',
  });
  assert.equal(out.usable, false, '구두점 차이로 실패를 놓쳤다');
});

test('역번역이 비어 있으면 이 검사의 일이 아니다', () => {
  const out = checkBackTranslation({
    backTranslation: '',
    refined: '您好。',
    sourceLanguage: 'ko',
    targetLanguage: 'zh',
  });
  assert.equal(out.usable, true);
});

test('실패 문구는 원인과 다음 행동을 함께 말한다', () => {
  assert.match(backFailMessage(BACK_FAIL.SAME_AS_REFINED), /다시 만들기/);
  assert.match(backFailMessage(BACK_FAIL.WRONG_SCRIPT), /다시 만들기/);
  assert.equal(backFailMessage(null), '');
});

/* ── 캐주얼 톤 언어 커버리지 ──────────────────────────────────────────── */

test('🔴 지원하는 모든 언어에 캐주얼 표현이 있다 (2026-08-16 — 4개 언어가 비어 있었다)', () => {
  for (const language of RECIPIENT_LANGUAGES) {
    const block = buildCasualToneBlock(language, true);
    assert.ok(
      block && block.expressions.length > 0,
      `${language}: 캐주얼 톤을 켜도 아무것도 실리지 않는다 — 토글이 무동작이다`,
    );
  }
});

test('🔴 캐주얼을 끄면 어느 언어에서도 아무것도 실리지 않는다 (밈 자동 삽입 금지)', () => {
  for (const language of RECIPIENT_LANGUAGES) {
    assert.equal(buildCasualToneBlock(language, false), null, `${language}에서 꺼도 표현이 나갔다`);
  }
});

/* ── 설명 문구 언어 검사 (2026-08-16 실확장에서 발견한 형제 결함) ────────── */

test('🔴 실측 — 「AI 판정 근거」가 독일어로 오면 감춘다', () => {
  assert.equal(
    isExplanationReadable(
      'Der Rollout muss unbedingt heute erfolgen, was sofortiges Handeln erfordert.',
      'ko',
      'de',
    ),
    false,
  );
});

test('한국어로 온 근거는 그대로 보여준다', () => {
  assert.equal(
    isExplanationReadable('배포를 오늘까지 반드시 완료해야 하므로 긴급합니다.', 'ko', 'de'),
    true,
  );
});

test('🔴 영어 사용자에게는 판정하지 않는다 — 라틴 문자끼리는 구분할 수 없다', () => {
  assert.equal(isExplanationReadable('Der Rollout muss heute erfolgen.', 'en', 'de'), true);
});

test('빈 값·같은 언어쌍은 판정하지 않는다', () => {
  assert.equal(isExplanationReadable('', 'ko', 'de'), true);
  assert.equal(isExplanationReadable('Anything at all', 'ko', 'ko'), true);
});

/* ── 자동 재시도 조건 (2026-08-16 ① — 코드가 아니라 판정 계약을 지킨다) ──── */

test('🔴 폴백 응답은 재시도 대상이 아니다 — 다시 불러도 역번역이 없다', () => {
  // 폴백은 `backTranslation: ''`을 준다. 빈 값은 「실패」가 아니라 「없음」이다.
  const out = checkBackTranslation({
    backTranslation: '',
    refined: '배포는 반드시 오늘까지 해야 합니다',
    sourceLanguage: 'ko',
    targetLanguage: 'en',
  });
  assert.equal(out.usable, true, '빈 역번역을 실패로 판정하면 폴백마다 호출을 두 번 태운다');
});

/* ── ⓑ 폴백 재시도 판정 (2026-08-16) ──────────────────────────────────── */

/**
 * 🔴 재시도 여부는 `SaiOverlay`의 effect가 정하지만, **판정 규칙 자체**는 여기서 잠근다.
 *    규칙이 흔들리면 ① 되살아날 수 있는 실패를 그냥 버리거나 ② 살아날 리 없는 실패에
 *    호출을 두 배로 태운다 — 둘 다 조용히 일어나서 아무도 모른다.
 */
function shouldRetryFallback(result) {
  return result.fallback === true && result.fallbackReason === 'invalid';
}

test('🔴 invalid 폴백은 다시 부른다 — 모델 출력이 확률적이라 살아날 수 있다', () => {
  assert.equal(shouldRetryFallback({ fallback: true, fallbackReason: 'invalid' }), true);
});

test('🔴 quota·error 폴백은 다시 부르지 않는다 — 같은 결과에 호출만 두 배가 된다', () => {
  assert.equal(shouldRetryFallback({ fallback: true, fallbackReason: 'quota' }), false);
  assert.equal(shouldRetryFallback({ fallback: true, fallbackReason: 'error' }), false);
});

test('정상 응답은 재시도 대상이 아니다', () => {
  assert.equal(shouldRetryFallback({ fallback: false, fallbackReason: null }), false);
  assert.equal(shouldRetryFallback({}), false);
});

test('🔴 폴백 사유 이름이 바뀌면 이 테스트가 먼저 깨진다', async () => {
  const { FALLBACK_REASONS } = await import('../src/core/refine/fallback.js');
  assert.equal(FALLBACK_REASONS.INVALID, 'invalid', '재시도 조건이 참조하는 값이 바뀌었다');
  assert.equal(FALLBACK_REASONS.QUOTA, 'quota');
  assert.equal(FALLBACK_REASONS.ERROR, 'error');
});
