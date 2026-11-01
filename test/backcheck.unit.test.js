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
  isRefinedInTargetScript,
  isRefinedComplete,
  isCurrencyConsistent,
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

/* ── 교정문 언어 검사 (2026-11-01, 판정표 `isRefinedInTargetScript`) ───────── */

test('행 1 — 같은 언어·빈 교정문은 통과', () => {
  assert.equal(isRefinedInTargetScript('그대로입니다', 'ko', 'ko'), true);
  assert.equal(isRefinedInTargetScript('', 'ko', 'ja'), true);
});

test('🔴 행 2 — 상대 언어 고유 문자가 없으면 실패 (실측: zh·ja 목표에 한국어 교정문)', () => {
  assert.equal(isRefinedInTargetScript('금요일까지 처리 가능한지 확인 부탁드립니다.', 'ko', 'zh'), false);
  assert.equal(isRefinedInTargetScript('Nexus 대시보드 접근 권한 요청 건, 금요일까지 부탁드립니다.', 'ko', 'ja'), false);
  assert.equal(isRefinedInTargetScript('Could you review this?', 'en', 'ko'), false);
});

test('🔴 행 3 — 라틴 목표에 한글이 절반을 넘으면 실패', () => {
  assert.equal(isRefinedInTargetScript('금요일까지 처리 가능할까요?', 'ko', 'fr'), false);
});

test('행 4 — 상대 언어 문장에 등록 호칭 몇 글자가 섞인 것은 정상', () => {
  assert.equal(isRefinedInTargetScript('您好，김 대리님已申请Nexus仪表板的访问权限。请问能否在周五前处理？', 'ko', 'zh'), true);
  assert.equal(isRefinedInTargetScript('Bonjour, 김 대리님 a demandé l\'accès au tableau de bord Nexus.', 'ko', 'fr'), true);
  assert.equal(isRefinedInTargetScript('キム・スジン様よりご依頼をいただいております。', 'ko', 'ja'), true);
});

/* ── 교정문 잘림 검사 (2026-11-01, 판정표 `isRefinedComplete`) ───────── */

const KO_S1 = '납품이 3월 14일에서 3월 21일로 1주일 밀립니다. 견적은 1,250만 원 그대로이고, 수량 300개는 변동 없습니다.';

test('🔴 행 3 — 실측: 중국어 교정문이 「人民币... 」로 끊기면 실패', () => {
  assert.equal(isRefinedComplete('您好,交货日期将从3月14日顺延至3月21日,延后一周。报价仍为人民币... ', KO_S1), false);
  assert.equal(isRefinedComplete('The quote remains at…', KO_S1), false);
  assert.equal(isRefinedComplete('見積もりは。。。', KO_S1), false);
});

test('🔴 행 3 — 실측: 문장 중간에서 「人民币... 不对」로 머뭇거린 교정문도 실패', () => {
  assert.equal(isRefinedComplete('报价保持不变，为人民币... 不对，报价为韩元12,500,000，数量300个保持不变。', KO_S1), false);
  assert.equal(isRefinedComplete('报价仍为人民币... 韩元 12,500,000，数量300个保持不变。', KO_S1), false);
});

test('행 1·2·4 — 빈 교정문·온전한 문장·원문에도 있는 말줄임표는 통과', () => {
  assert.equal(isRefinedComplete('', KO_S1), true);
  assert.equal(isRefinedComplete('报价仍为1,250万韩元，数量300个保持不变。', KO_S1), true);
  assert.equal(isRefinedComplete('Hmm… let me check and get back to you.', '음… 확인해 볼게요.'), true);
});

test('행 2 — 원문이 말줄임표로 끝나면 교정문도 그래도 통과', () => {
  assert.equal(isRefinedComplete('Well, we will see...', '글쎄요, 두고 봐야죠...'), true);
  assert.equal(isRefinedComplete('Thanks…', '감사합니다…'), true);
});

/* ── 통화 검사 (2026-11-01, 판정표 `isCurrencyConsistent`) ───────── */

test('🔴 행 3 — 실측: 원(원)이 위안·엔으로 바뀌면 실패', () => {
  assert.equal(isCurrencyConsistent('报价仍为人民币12,500,000元(1,250万韩元)', KO_S1), false);
  assert.equal(isCurrencyConsistent('The quote stays at RMB 12.5 million.', KO_S1), false);
  assert.equal(isCurrencyConsistent('見積もりは1,250万円のままです。', KO_S1), false);
});

test('행 1 — 헷갈릴 여지가 있는 표기(元 하나·¥·숫자 없는 円)는 보지 않는다', () => {
  assert.equal(isCurrencyConsistent('报价仍为1,250万韩元。', KO_S1), true);
  assert.equal(isCurrencyConsistent('报价为12,500,000元。', KO_S1), true);
  assert.equal(isCurrencyConsistent('円滑に進めるため、見積もりは1,250万ウォンのままです。', KO_S1), true);
  assert.equal(isCurrencyConsistent('', KO_S1), true);
});

test('행 2 — 원문에 있던 통화면 통과', () => {
  assert.equal(isCurrencyConsistent('The quote is 5 million yen.', '견적은 500만 엔입니다.'), true);
  assert.equal(isCurrencyConsistent('报价为人民币5万元。', '견적은 5만 위안입니다.'), true);
});
