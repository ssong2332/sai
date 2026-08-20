/**
 * S13 — 개인 수정 패턴 분류·우선순위 단위 테스트 (Spec 필수 2 · 권장 11 · 필수 5).
 *
 * 🔴 이 테스트가 지키려는 핵심 두 가지:
 *    ① 판정표 A에 없는 수정은 **기록하지 않는다**(추측 금지).
 *    ② 반환값·저장값에 **원문 조각이 없다**(Zero Retention).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  levenshtein,
  classifyEdit,
  selectLearnedHints,
  categoryLabel,
  LEARNING_THRESHOLD,
  DIFF_CATEGORIES,
} from '../src/core/profile/diff.js';

test('levenshtein — 같은 문자열은 0', () => {
  assert.equal(levenshtein('hello', 'hello'), 0);
});

test('levenshtein — 빈 문자열은 상대 길이', () => {
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('levenshtein — 한 글자 치환은 1', () => {
  assert.equal(levenshtein('kitten', 'sitten'), 1);
});

test('levenshtein — 고전 예시(kitten→sitting)는 3', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('편집이 없으면 아무것도 분류하지 않는다 — "적용만 눌렀다"는 성향이 아니다', () => {
  const outcome = classifyEdit('Please review PR #482 by 3pm.', 'Please review PR #482 by 3pm.');
  assert.equal(outcome.distance, 0);
  assert.deepEqual(outcome.categoryIds, []);
});

test('표 A 1행 — 모호한 긴급 표현이 빠지고 구체 시각이 들어가면 deadline-explicit', () => {
  const outcome = classifyEdit(
    'Please review the PR ASAP.',
    'Please review the PR by 3pm.',
  );
  assert.ok(outcome.categoryIds.includes('deadline-explicit'));
});

test('표 A 1행 — 모호한 표현만 빠지고 구체 시각이 없으면 기록하지 않는다', () => {
  const outcome = classifyEdit('Please review the PR ASAP.', 'Please review the PR.');
  assert.ok(!outcome.categoryIds.includes('deadline-explicit'));
});

test('표 A 2행 — 사과 표현이 줄면 fewer-apologies', () => {
  const outcome = classifyEdit(
    'Sorry to bother you, and sorry for the delay, could you check this?',
    'Could you check this?',
  );
  assert.ok(outcome.categoryIds.includes('fewer-apologies'));
});

test('표 A 2행 — 사과 표현이 늘면 해당 없음(반대 방향은 같은 성향이 아니다)', () => {
  const outcome = classifyEdit('Could you check this?', 'Sorry, could you check this?');
  assert.ok(!outcome.categoryIds.includes('fewer-apologies'));
});

test('표 A 3행 — 이모지가 제거되면 no-emoji', () => {
  const outcome = classifyEdit('확인 부탁드려요 🙏😊', '확인 부탁드려요');
  assert.ok(outcome.categoryIds.includes('no-emoji'));
});

test('표 A 5행 — 합쇼체↔해요체가 뒤집히면 honorific-shift', () => {
  const outcome = classifyEdit(
    '확인했습니다. 곧 전달하겠습니다. 감사합니다.',
    '확인했어요. 곧 전달할게요. 고마워요.',
  );
  assert.ok(outcome.categoryIds.includes('honorific-shift'));
});

test('표 A 어디에도 안 맞는 수정은 categoryIds가 비어 있다 — 지어내지 않는다', () => {
  const outcome = classifyEdit('The build finished.', 'The deploy finished.');
  assert.ok(outcome.distance > 0, '편집 거리 자체는 잡혀야 한다');
  assert.deepEqual(outcome.categoryIds, [], '분류는 비어야 한다');
});

test('🔴 Zero Retention — 반환값 어디에도 입력 문자열 조각이 없다', () => {
  const aiText = 'Please review PR #482 ASAP, and sorry for the rush 🙏';
  const userText = 'Please review PR #482 by 3pm.';
  const outcome = classifyEdit(aiText, userText);

  const serialized = JSON.stringify(outcome);
  for (const fragment of ['PR #482', 'review', 'sorry', 'rush', '3pm']) {
    assert.ok(
      !serialized.includes(fragment),
      `반환값에 원문 조각 "${fragment}"이 담기면 안 된다: ${serialized}`,
    );
  }
  // 담겨도 되는 것은 수치와 고정 카테고리 id뿐이다.
  assert.equal(typeof outcome.distance, 'number');
  for (const id of outcome.categoryIds) {
    assert.ok(
      DIFF_CATEGORIES.some((category) => category.id === id),
      `고정 집합 밖의 id가 나왔다: ${id}`,
    );
  }
});

/* ── 판정표 B — 과도기 규칙 ─────────────────────────────────────────────── */

test('판정표 B — 3회 미만 카테고리는 싣지 않는다 (1순위만 100%)', () => {
  const hints = selectLearnedHints({ 'no-emoji': LEARNING_THRESHOLD - 1 });
  assert.deepEqual(hints, []);
});

test('판정표 B — 정확히 3회면 싣는다 (경계값)', () => {
  const hints = selectLearnedHints({ 'no-emoji': LEARNING_THRESHOLD });
  assert.equal(hints.length, 1);
  assert.equal(hints[0].id, 'no-emoji');
});

test('판정표 B — 임계 미만/이상이 섞이면 이상인 것만 싣는다', () => {
  const hints = selectLearnedHints({
    'no-emoji': LEARNING_THRESHOLD + 2,
    'fewer-apologies': 1,
    shorter: LEARNING_THRESHOLD,
  });
  const ids = hints.map((hint) => hint.id).sort();
  assert.deepEqual(ids, ['no-emoji', 'shorter']);
});

test('판정표 B — 빈 입력에도 안전하다', () => {
  assert.deepEqual(selectLearnedHints({}), []);
  assert.deepEqual(selectLearnedHints(undefined), []);
});

test('🔴 어떤 카테고리도 국가·문화권을 언급하지 않는다 (Spec 필수 2 3순위 · 필수 9 G1/G2)', () => {
  const banned = [
    'countr',
    'nation',
    'culture',
    'cultural',
    'korean people',
    '국가',
    '문화권',
    '국민',
  ];
  for (const category of DIFF_CATEGORIES) {
    const text = `${category.label} ${category.promptHint}`.toLowerCase();
    for (const word of banned) {
      assert.ok(
        !text.includes(word),
        `카테고리 ${category.id}에 국가/문화권 표현 "${word}"이 있으면 안 된다`,
      );
    }
  }
});

test('표시 문장은 고정 집합에서만 나오고, 모르는 id는 null이다 (지어내지 않는다)', () => {
  assert.equal(typeof categoryLabel('no-emoji'), 'string');
  assert.equal(categoryLabel('made-up-id'), null);
});

/* ── 중국어 커버리지 (2026-08-13 실확장 테스트에서 발견) ───────────────── */

/**
 * 🔴 실제로 난 사고: Spec §1은 ko·en·zh를 지원하고 온보딩도 "중화권"을 제공하는데, 판정표 A의
 *    사과·마감 패턴이 **ko·en만** 알고 있었다. 그래서 중화권을 고른 사용자는 교정문이 중국어가
 *    되고, 무엇을 고쳐도 `shorter`/`no-emoji` 외에는 영원히 분류되지 않았다 — 조용히.
 */
test('중국어 사과 표현을 줄인 수정을 분류한다 (抱歉)', () => {
  const before = '米格尔，构建失败了。很抱歉，能否请您在明天之前确认一下？';
  const after = '米格尔，构建失败了。能否请您在明天之前确认一下？';
  assert.ok(classifyEdit(before, after).categoryIds.includes('fewer-apologies'));
});

test('중국어 사과 표현을 줄인 수정을 분류한다 (不好意思)', () => {
  const before = '不好意思，这个功能还没有完成。';
  const after = '这个功能还没有完成。';
  assert.ok(classifyEdit(before, after).categoryIds.includes('fewer-apologies'));
});

test('중국어 구체 날짜로 바꾼 수정을 분류한다', () => {
  const before = '请尽快确认这个问题。';
  const after = '请在8月14日之前确认这个问题。';
  assert.ok(classifyEdit(before, after).categoryIds.includes('deadline-explicit'));
});

test('중국어 구체 시각(点)도 마감 명시로 본다', () => {
  const before = '请马上回复。';
  const after = '请在下午3点之前回复。';
  assert.ok(classifyEdit(before, after).categoryIds.includes('deadline-explicit'));
});

test('세 지원 언어 모두 사과 표현 감소를 인식한다', () => {
  const cases = [
    ['Sorry, could you check this?', 'Could you check this?'],
    ['죄송하지만 확인 부탁드립니다.', '확인 부탁드립니다.'],
    ['很抱歉，请确认一下。', '请确认一下。'],
  ];
  for (const [before, after] of cases) {
    assert.ok(
      classifyEdit(before, after).categoryIds.includes('fewer-apologies'),
      `이 언어의 사과 표현이 인식되지 않았다: ${before}`,
    );
  }
});

/**
 * 🔴 **말투 옵션 확장 (2026-08-20 ⓑ)** — 늘리면서 깨지기 쉬운 두 가지를 잠근다.
 */
test('말투 id가 수신자 태그 id와 겹치지 않는다 — 「내가 쓰는 방식」과 「상대가 원하는 것」은 다른 값이다', async () => {
  const { COLLAB_STYLES } = await import('../src/lib/profile.js');
  const { RECIPIENT_TAGS } = await import('../src/lib/recipients.js');
  const tagIds = new Set(RECIPIENT_TAGS.map((item) => item.id));
  for (const style of COLLAB_STYLES) {
    assert.equal(tagIds.has(style.id), false, `말투 id가 수신자 태그와 겹친다: ${style.id}`);
  }
});

test('말투 힌트는 상대가 아니라 «내 문장»에 대한 지시다 - 수신자를 언급하지 않는다', async () => {
  const { COLLAB_STYLES } = await import('../src/lib/profile.js');
  assert.ok(COLLAB_STYLES.length >= 5, '결론 먼저·근거를 함께가 빠졌다');
  for (const style of COLLAB_STYLES) {
    assert.ok(style.hint.trim().length > 20, `힌트가 너무 짧다: ${style.id}`);
    assert.doesNotMatch(style.hint, /recipient/i, `수신자를 언급한다: ${style.id}`);
  }
  const hints = new Set(COLLAB_STYLES.map((item) => item.hint));
  assert.equal(hints.size, COLLAB_STYLES.length, '같은 힌트가 두 번 쓰였다');
});

/**
 * 🔴 **힌트를 «구체적 지시»로 바꾸면서 생긴 새 위험** (2026-08-20 ⓒ′).
 *    추상적 선호일 때는 모델이 알아서 자제했지만, 이제는 시키는 대로 한다 - 그래서
 *    「근거를 함께」가 **없는 이유를 지어낼** 수 있다. 지어내지 않는다는 금지를 힌트 안에
 *    박아 두고, 그게 지워지지 않게 잠근다 (Spec: 원문에 없는 사실을 만들지 않는다).
 */
test('「근거를 함께」 힌트는 이유를 지어내는 것을 금지한다', async () => {
  const { COLLAB_STYLES } = await import('../src/lib/profile.js');
  const rationale = COLLAB_STYLES.find((item) => item.id === 'rationale');
  assert.ok(rationale, 'rationale 항목이 없다');
  assert.match(rationale.hint, /never invent/i);
});

/**
 * 🔴 **override는 «축»에 한정되어야 한다** (2026-08-20 ⓒ′).
 *    `profile`은 클라이언트가 보내는 값이라, "무엇이든 이긴다"로 쓰면 프롬프트 주입 통로가 된다.
 *    문장 형태·공손도까지만 이기고 마감·숫자·요구 행동은 못 건드린다는 문장이 함께 있어야 한다.
 */
test('프로필 규칙의 override가 마감·숫자·요구 행동까지 열어 주지 않는다', async () => {
  const { buildRefinePayload } = await import('../src/core/refine/prompt.js');
  const payload = buildRefinePayload({
    text: '금요일까지 올려 주세요.',
    sourceLanguage: 'ko',
    targetLanguage: 'en',
    userUrgency: null,
    profile: { situation: null, collabStyle: 'x'.repeat(30), learned: [] },
    referenceDate: '2026-08-20',
  });
  assert.match(payload.instruction, /sentence form and politeness level ONLY/);
  assert.match(payload.instruction, /NEVER weaken, delay, blur, or remove a deadline/);
});

/* ── 화행 보존 (2026-08-20 사용자 실사용 제보) ─────────────────────────── */

/**
 * 🔴 **문체가 «화행»을 바꾸면 안 된다.**
 *    「배포하셔도 됩니다」(허가)가 말투를 켜자 `Could you proceed …?`(요청)로 뒤집혔다.
 *    말투를 끄면 `you can proceed`로 정확했으므로 번역력이 아니라 «규칙»의 문제였다.
 *    보존 규칙이 마감·숫자·요구 행동·부정문만 잠그고 화행은 안 잠갔던 것이 원인이다.
 */
test('🔴 보존 규칙이 화행을 잠근다 — 허가가 요청이 되면 안 된다', async () => {
  const { buildRefinePayload } = await import('../src/core/refine/prompt.js');
  const payload = buildRefinePayload({
    text: '문제 없어서 그대로 배포하셔도 됩니다.',
    sourceLanguage: 'ko',
    targetLanguage: 'en',
    userUrgency: null,
    referenceDate: '2026-08-20',
  });
  assert.match(payload.instruction, /SPEECH ACT/);
  assert.match(payload.instruction, /granting permission/);
  // 🔴 「부정문을 잃는 것과 같은 급」이라는 표현이 이 금지의 무게를 준다 — 지우면 약해진다.
  assert.match(payload.instruction, /failure exactly like losing a negation/);
});

/**
 * 🔴 **힌트가 「요청이 있다」고 전제하면 안 된다.** 전제하면 모델이 지시를 이행하려고
 *    **없는 요청을 만들어 낸다** — 위 결함의 직접 원인이었다.
 */
test('🔴 문장 형태를 바꾸는 말투는 «요청이 있을 때»로 조건이 걸려 있다', async () => {
  const { COLLAB_STYLES } = await import('../src/lib/profile.js');
  for (const id of ['direct', 'warm']) {
    const style = COLLAB_STYLES.find((item) => item.id === id);
    assert.match(style.hint, /^If the message asks for something/, `${id}에 조건절이 없다`);
    assert.match(style.hint, /does not ask for anything/, `${id}에 «없을 때» 규칙이 없다`);
  }
});

test('🔴 어떤 힌트도 무조건적으로 "the request"가 있다고 말하지 않는다', async () => {
  const { COLLAB_STYLES } = await import('../src/lib/profile.js');
  for (const style of COLLAB_STYLES) {
    assert.doesNotMatch(
      style.hint,
      /^(Phrase|Keep only|Put) the request/,
      `${style.id}가 요청의 존재를 전제한다`,
    );
  }
});
