/**
 * 긴급도 → 톤 반영 계약 (Spec 필수 1). 2026-08-18 신설.
 *
 * 🔴 **왜 생겼나.** 긴급도 버튼이 **아무 효과가 없었다** — 같은 원문에 LOW와 CRITICAL을 지정했는데
 *    실측 결과 **글자 하나 다르지 않은 같은 문장**이 나왔다. 이 제품의 1번 기능(필수 1)이 화면에만
 *    있고 실제로는 동작하지 않은 것이다. 잡을 수 있는 관문이 하나도 없었다:
 *      - 빌드는 통과한다 (문자열 조립일 뿐이다).
 *      - `no-undef`도 못 잡는다.
 *      - 단위 테스트는 지시문이 «존재하는지»만 봤지 «레벨마다 다른지»는 보지 않았다.
 *    그래서 여기서 **레벨별로 지시문이 실제로 갈리는지**와 **배치가 이기는지**를 직접 대조한다.
 *
 * 🔴 **이 테스트는 모델 출력을 검증하지 않는다** — 네트워크 없이 도는 계약 테스트다. 실제 문장이
 *    달라지는지는 실 API로 따로 확인했고(2026-08-18), 그 결과는 `docs/DemoScript.md`에 적혀 있다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRefinePayload } from '../src/core/refine/prompt.js';

const BASE = {
  text: '반드시 오늘까지 배포해야 합니다.',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-18',
};
const instructionFor = (userUrgency) => buildRefinePayload({ ...BASE, userUrgency }).instruction;

test('🔴 세 레벨의 지시문이 서로 다르다 — 같으면 버튼이 화면에만 있는 것이다', () => {
  const low = instructionFor('LOW');
  const normal = instructionFor('NORMAL');
  const critical = instructionFor('CRITICAL');
  assert.notEqual(low, normal, 'LOW와 NORMAL의 지시가 같다');
  assert.notEqual(normal, critical, 'NORMAL과 CRITICAL의 지시가 같다');
  assert.notEqual(low, critical, 'LOW와 CRITICAL의 지시가 같다');
});

test('🔴 레벨마다 «무엇을 바꿀지»가 적혀 있다 — 금지만 있으면 모델이 안 바꾼다', () => {
  // 옛 규칙은 "톤을 맞춰라" + 금지 두 개뿐이라 모델이 아무것도 하지 않았다.
  assert.match(instructionFor('CRITICAL'), /FIRST sentence/, 'CRITICAL에 구체적 지시가 없다');
  assert.match(instructionFor('LOW'), /question form/, 'LOW에 구체적 지시가 없다');
  assert.match(instructionFor('NORMAL'), /adding neither extra pressure nor/, 'NORMAL에 구체적 지시가 없다');
});

test('🔴 반대편 레벨의 금지가 딸려 오지 않는다 — 그게 서로를 상쇄했다', () => {
  const low = instructionFor('LOW');
  assert.doesNotMatch(
    low,
    /do not soften a CRITICAL message/,
    'LOW인데 "CRITICAL을 부드럽게 만들지 마라"가 붙어 있다 — 모델이 "아무것도 바꾸지 말라"로 읽는다',
  );
});

test('🔴 LOW가 «없던 여유»를 만들어 내지 않는다 (2026-08-18 방향 전환)', () => {
  /**
   * 처음에는 반대로 만들었다 — LOW에 `when you get a chance` 추가를 **허용**하고 금지를
   * 넘어선다고까지 적었다. 그 결과 원문 「반드시 오늘까지」가 「…by today when you get a
   * chance?」가 됐다. **원문과 모순되는 말을 우리가 지어낸 것**이고, 이 제품이 다른 번역기를
   * 비판하는 근거(마감을 흐린다)와 같은 결함이다. 되돌렸고, 다시 들어오지 못하게 잠근다.
   */
  const low = instructionFor('LOW');
  assert.doesNotMatch(low, /overrides the general ban/, '완충어 금지를 넘어서는 허가가 되살아났다');
  assert.match(low, /never introduce "when you get a chance"/, '금지 예시가 없다');
  assert.match(low, /just as binding/, '마감이 그대로 구속력을 갖는다는 조항이 없다');
});

test('🔴 긴급도 규칙이 완충 표현 금지 **뒤**에 온다 — 배치가 곧 우선순위다', () => {
  /**
   * 이것이 실패의 절반이었다. 규칙 내용을 아무리 고쳐도, 완충 표현을 금지하는 문장이 **뒤에**
   * 있으면 최신성으로 이긴다(역번역 문제로 4번 실패하며 배운 것과 같은 함정).
   */
  const low = instructionFor('LOW');
  const banAt = low.indexOf('Do NOT add softening hedges');
  const urgencyAt = low.indexOf('URGENCY LEVEL CHOSEN BY THE USER');
  assert.ok(banAt >= 0, '완충 표현 금지 문장을 못 찾았다 — 테스트가 낡았다');
  assert.ok(urgencyAt >= 0, '긴급도 규칙을 못 찾았다 — 테스트가 낡았다');
  assert.ok(urgencyAt > banAt, '긴급도 규칙이 금지보다 앞에 있다 — 금지가 이겨서 톤이 안 바뀐다');
});

test('🔴 어떤 레벨이든 «사실은 안 바꾼다»가 함께 실린다', () => {
  for (const level of ['LOW', 'NORMAL', 'CRITICAL']) {
    assert.match(
      instructionFor(level),
      /never changes a deadline, a number, a required action, or a negation/,
      `${level}에 사실 보존 조항이 없다 — 톤을 바꾸다 마감을 잃는다`,
    );
  }
});

test('긴급도를 안 고르면 톤 지시가 아예 실리지 않는다', () => {
  // 🔴 기본값을 채우면 "사용자가 고른 것"과 "안 고른 것"이 구분되지 않는다.
  assert.doesNotMatch(instructionFor(null), /URGENCY LEVEL CHOSEN BY THE USER/);
  assert.doesNotMatch(instructionFor(undefined), /URGENCY LEVEL CHOSEN BY THE USER/);
});

test('🔴 모르는 레벨에는 지어낸 톤 지시를 만들지 않는다', () => {
  assert.doesNotMatch(instructionFor('URGENT'), /URGENCY LEVEL CHOSEN BY THE USER/);
  assert.doesNotMatch(instructionFor('low'), /URGENCY LEVEL CHOSEN BY THE USER/);
});


test('🔴 긴급도 지시는 «압박»만 말한다 — «문체»를 언급하면 격식 설정을 덮어쓴다', () => {
  /**
   * 2026-08-18 실측: NORMAL 지시문의 "neutral professional register … (could you)"가
   * 뒤에서 격식체 지시를 덮어써 **격식 토글이 통째로 무효**였다. 두 축이 같은 것을 말하면
   * 뒤엣것이 이긴다 — 긴급도는 압박, 격식은 문체로 역할을 갈라 둔다.
   */
  for (const level of ['LOW', 'NORMAL', 'CRITICAL']) {
    assert.doesNotMatch(
      instructionFor(level),
      /professional register/,
      `${level} 긴급도 지시가 문체(register)를 규정한다 — 격식 설정과 충돌한다`,
    );
  }
});
