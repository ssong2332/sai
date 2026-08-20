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

test('말투 힌트는 모두 "The user"로 시작한다 — 상대가 아니라 나에 대한 지시여야 한다', async () => {
  const { COLLAB_STYLES } = await import('../src/lib/profile.js');
  assert.ok(COLLAB_STYLES.length >= 5, '결론 먼저·근거를 함께가 빠졌다');
  for (const style of COLLAB_STYLES) {
    assert.match(style.hint, /^The user prefers /, `힌트 주어가 틀렸다: ${style.id}`);
  }
});
