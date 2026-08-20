/**
 * S19 — 이모지 자동 교체 (Spec 권장 4) + 위험 표현 탐지 (Spec 권장 6 F-18).
 *
 * 🔴 핵심 검증:
 *    ① 바꾼 내용을 **반드시 함께 돌려준다**(조용한 교체 금지).
 *    ② 사유 문구에 **국가 단정이 없다**(필수 2 3순위 · 필수 9).
 *    ③ 위험 표현은 Spec이 명시한 3종만 — 안전망은 드물게 켜져야 안전망이다.
 *    ④ 사과는 3회째부터만 표시(1~2회는 정상적인 예의).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMOJI_RULES,
  swapRiskyEmoji,
  findRiskySpans,
  findDroppedRiskyEmoji,
  RISK_KINDS,
  RISK_LABELS,
} from '../src/core/emoji/index.js';
import { buildRefinePayload, REFINE_PROMPT_VERSION } from '../src/core/refine/prompt.js';

/* ── 판정표 C — 이모지 ───────────────────────────────────────────────── */

test('위험한 이모지를 교체하고 무엇을 바꿨는지 함께 돌려준다', () => {
  const out = swapRiskyEmoji('좋아요 👍 확인 부탁드려요');
  assert.ok(!out.text.includes('👍'));
  assert.ok(out.text.includes('✅'));
  assert.equal(out.replacements.length, 1);
  assert.equal(out.replacements[0].from, '👍');
});

test('대체재가 없는 이모지는 삭제한다', () => {
  const out = swapRiskyEmoji('이건 좀 💩 같아요');
  assert.ok(!out.text.includes('💩'));
  assert.equal(out.replacements[0].to, '');
});

test('같은 이모지가 여러 번 나와도 전부 바뀐다', () => {
  const out = swapRiskyEmoji('👍👍👍');
  assert.ok(!out.text.includes('👍'));
  assert.equal(out.replacements.length, 1, '안내는 종류당 1건이면 충분하다');
});

test('위험하지 않은 이모지는 건드리지 않는다', () => {
  const out = swapRiskyEmoji('확인했습니다 🙂 감사합니다');
  assert.equal(out.text, '확인했습니다 🙂 감사합니다');
  assert.equal(out.replacements.length, 0);
});

test('바꿀 게 없으면 replacements가 비어 있다 — 안내를 띄우지 않는 근거', () => {
  assert.deepEqual(swapRiskyEmoji('평범한 문장입니다').replacements, []);
});

test('이모지를 지운 자리에 이중 공백이 남지 않는다', () => {
  const out = swapRiskyEmoji('감사합니다 🙏 그럼 부탁드려요');
  assert.ok(!out.text.includes('  '), `이중 공백이 남았다: "${out.text}"`);
});

test('🔴 사유 문구에 국가·국민 단정이 없다 (필수 2 3순위 · 필수 9)', () => {
  const banned = [
    '나라', '국가', '국민', '문화권', '미국', '중국', '일본', '독일', '브라질', '중동',
    'countr', 'nation', 'american', 'chinese', 'arab',
  ];
  for (const rule of EMOJI_RULES) {
    const text = rule.reason.toLowerCase();
    for (const word of banned) {
      assert.ok(!text.includes(word), `이모지 ${rule.from} 사유에 "${word}"가 있으면 안 된다`);
    }
  }
});

test('모든 규칙이 사유 문구를 갖는다 — 근거 없이 바꾸지 않는다', () => {
  for (const rule of EMOJI_RULES) {
    assert.ok(rule.reason && rule.reason.length > 0, `${rule.from}에 사유가 없다`);
  }
});

/* ── 판정표 D — 위험 표현 ────────────────────────────────────────────── */

function kindsOf(text) {
  return findRiskySpans(text).map((span) => span.kind);
}

test('명령조를 잡는다', () => {
  assert.ok(kindsOf('You must fix this today.').includes(RISK_KINDS.IMPERATIVE));
  assert.ok(kindsOf('반드시 오늘까지 해야 합니다.').includes(RISK_KINDS.IMPERATIVE));
});

test('단정적 부정을 잡는다', () => {
  assert.ok(kindsOf('That will never work.').includes(RISK_KINDS.ABSOLUTE_NEGATIVE));
  assert.ok(kindsOf('그건 절대 안 됩니다.').includes(RISK_KINDS.ABSOLUTE_NEGATIVE));
});

test('🔴 사과 1~2회는 위험으로 보지 않는다 — 정상적인 예의다', () => {
  assert.equal(kindsOf('Sorry for the delay.').length, 0);
  assert.equal(kindsOf('Sorry, and again sorry for that.').length, 0);
});

test('🔴 사과 3회 이상이면 3번째부터 표시한다', () => {
  const spans = findRiskySpans('Sorry, sorry, and sorry again for the trouble.');
  const apologies = spans.filter((span) => span.kind === RISK_KINDS.EXCESSIVE_APOLOGY);
  assert.equal(apologies.length, 1, '3번째 한 건만 표시해야 한다');
});

test('평범한 문장에는 아무 표시도 하지 않는다 — 안전망은 드물게 켜져야 한다', () => {
  assert.deepEqual(findRiskySpans('Could you review this by tomorrow morning?'), []);
});

test('반환값은 위치와 종류뿐 — 잘라낸 문자열을 담지 않는다', () => {
  const spans = findRiskySpans('You must fix this.');
  for (const span of spans) {
    assert.deepEqual(Object.keys(span).sort(), ['end', 'kind', 'start']);
  }
});

test('구간이 서로 겹치지 않는다 — 겹치면 밑줄 마크업이 깨진다', () => {
  const spans = findRiskySpans('You must never do this. Sorry, sorry, sorry.');
  for (let i = 1; i < spans.length; i += 1) {
    assert.ok(spans[i].start >= spans[i - 1].end, '구간이 겹쳤다');
  }
});

test('구간이 원문에서 실제 위치를 가리킨다', () => {
  // 밑줄은 의무를 만드는 **조동사**에만 긋는다("You must"의 you까지 칠할 이유가 없다).
  const text = 'Please check. You must reply today.';
  const [span] = findRiskySpans(text);
  assert.equal(text.slice(span.start, span.end).toLowerCase(), 'must');
});

test('모든 위험 종류에 표시 문구가 있다', () => {
  for (const kind of Object.values(RISK_KINDS)) {
    assert.ok(RISK_LABELS[kind], `${kind}에 라벨이 없다`);
  }
});

/* ── 실사용에서 드러난 패턴 공백 (2026-08-13 사용자 스크린샷) ─────────── */

/**
 * 🔴 실제로 난 사고: Spec의 예시 문구 `You must~`를 **문자 그대로** 넣는 바람에, 실제 교정문에
 *    흔한 수동태("This must be done")를 하나도 못 잡았다. 의무를 만드는 것은 주어가 아니라
 *    조동사다.
 */
test('수동태 의무 표현을 잡는다 — 주어가 you가 아니어도 명령조다', () => {
  assert.ok(kindsOf('This must be done by today.').includes(RISK_KINDS.IMPERATIVE));
  assert.ok(kindsOf('The fix needs to be deployed today.').includes(RISK_KINDS.IMPERATIVE));
  assert.ok(kindsOf('It has to be completed before the release.').includes(RISK_KINDS.IMPERATIVE));
});

test('"without fail"도 명령조로 본다 — "반드시"의 직역이다', () => {
  assert.ok(kindsOf('Please complete it today without fail.').includes(RISK_KINDS.IMPERATIVE));
});

test('사용자 실제 교정문에서 명령조와 3회째 사과를 함께 잡는다', () => {
  const real = 'I apologize This must be done by today without fail. I am sorry for the delay and truly sorry';
  const kinds = kindsOf(real);
  assert.ok(kinds.includes(RISK_KINDS.IMPERATIVE), '명령조를 놓쳤다');
  assert.ok(kinds.includes(RISK_KINDS.EXCESSIVE_APOLOGY), '3회째 사과를 놓쳤다');
});

test('단정적 부정의 다른 표현형도 잡는다', () => {
  assert.ok(kindsOf('That approach is not possible.').includes(RISK_KINDS.ABSOLUTE_NEGATIVE));
  assert.ok(kindsOf('We cannot support that.').includes(RISK_KINDS.ABSOLUTE_NEGATIVE));
});

test('🔴 평범한 부정문까지 잡지는 않는다 — 안전망은 드물게 켜져야 한다', () => {
  assert.deepEqual(findRiskySpans('I did not see the message yesterday.'), []);
  assert.deepEqual(findRiskySpans('This is not urgent.'), []);
});

/* ── 단정적 부정 — 실사용에서 놓친 형태 (2026-08-13 사용자 실측) ───────── */

test('must not을 단정적 부정으로 잡는다 — "절대 ~안 됩니다"의 번역형', () => {
  const text = 'The rollout must be completed today, and it must not be delayed.';
  const kinds = kindsOf(text);
  assert.ok(kinds.includes(RISK_KINDS.ABSOLUTE_NEGATIVE), 'must not을 놓쳤다');
});

test('한국어 "절대 … 안/못" 사이에 말이 들어가도 잡는다', () => {
  assert.ok(kindsOf('절대 미뤄지면 안 됩니다.').includes(RISK_KINDS.ABSOLUTE_NEGATIVE));
  assert.ok(kindsOf('이건 절대 못 합니다.').includes(RISK_KINDS.ABSOLUTE_NEGATIVE));
});

test('🔴 평범한 부정문은 여전히 잡지 않는다 (과탐 방지)', () => {
  assert.deepEqual(findRiskySpans('This will not be needed anymore.'), []);
  assert.deepEqual(findRiskySpans('I did not see it yesterday.'), []);
  assert.deepEqual(findRiskySpans('This is not urgent.'), []);
});

/* ── S27 후속: 모델이 이모지를 스스로 뺀 경우 (2026-08-14 실측) ────────── */

/**
 * 🔴 실측에서 드러난 것: `👍`·`🙏`가 든 원문을 넣었더니 교정문에 이모지가 **아예 없었다**.
 *    `swapRiskyEmoji`는 교정문에 남은 것만 바꾸므로 안내가 하나도 안 뜬다 — 사용자에겐
 *    "내가 쓴 👍가 왜 없지"만 남는다.
 */
test('원문에만 있고 교정문에 없는 위험 이모지를 찾아낸다', () => {
  const dropped = findDroppedRiskyEmoji('확인 부탁드려요 👍 잘 부탁합니다 🙏', 'Please review this.');
  assert.deepEqual(dropped.map((rule) => rule.from).sort(), ['🙏', '👍'].sort());
  for (const rule of dropped) {
    assert.ok(rule.reason && rule.reason.length > 0, '왜 빠졌는지 사유가 있어야 안내가 된다');
  }
});

test('🔴 교정문에 그대로 남은 이모지는 제외된다 — swapRiskyEmoji가 처리하므로 두 번 말하면 안 된다', () => {
  const dropped = findDroppedRiskyEmoji('확인 부탁해요 👍', 'Please review 👍');
  assert.deepEqual(dropped, []);
});

test('위험하지 않은 이모지가 빠진 것은 안내하지 않는다 — 안내는 위험 이모지 한정이다', () => {
  assert.deepEqual(findDroppedRiskyEmoji('안녕하세요 🙂', 'Hello.'), []);
});

test('원문·교정문이 비어도 터지지 않는다', () => {
  assert.deepEqual(findDroppedRiskyEmoji(null, undefined), []);
});

/* ── S27 후속: 이모지 프롬프트 규칙 (캐주얼 ON일 때만 유지) ────────────── */

const basePayload = {
  text: '확인 부탁드려요 👍',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-14',
};

test('캐주얼 OFF면 이모지를 교정문에 옮기지 말라고 지시한다', () => {
  const { instruction } = buildRefinePayload(basePayload);
  assert.ok(/do NOT carry emoji/i.test(instruction));
});

test('🔴 캐주얼 ON이면 원문의 이모지를 살리라고 지시한다 — 그래야 Work-Safe 교체가 의미를 갖는다', () => {
  const { instruction } = buildRefinePayload({
    ...basePayload,
    casualTone: { expressions: [{ text: 'LGTM', meaning: '승인' }] },
  });
  assert.ok(/carry the equivalent emoji through/i.test(instruction));
});

test('🔴 어느 경우에도 이모지를 새로 만드는 것은 금지한다', () => {
  for (const casualTone of [null, { expressions: [{ text: 'LGTM', meaning: '승인' }] }]) {
    const { instruction } = buildRefinePayload({ ...basePayload, casualTone });
    assert.ok(/never add (an emoji|new ones)/i.test(instruction), '이모지 신규 생성 금지가 빠졌다');
  }
});

test('🔴 프롬프트를 고쳤으면 버전이 올라 있어야 한다 — 옛 캐시가 새 프롬프트인 척한다', () => {
  // v8 (2026-08-14, S41): 자리표시자 보존 규칙 추가 — 회신 초안이 다듬기로 넘어온다.
  // v10 (2026-08-17): 사과 압축 규칙을 KO→EN 전용에서 **방향 공통**으로 올렸다.
  // v11 (2026-08-17): 실측에서 「한 문장에 쉼표로 두 개」가 규칙을 통과했다 — 개수로 못 박았다.
  assert.equal(REFINE_PROMPT_VERSION, 'refine-v21');
});

/**
 * 🔴 **사과 압축은 모든 언어쌍에 걸려야 한다** (2026-08-17 사용자 지적).
 *    실확장에서 한국어→독일어 교정이 원문의 사과 세 번을 그대로 옮겼다. 원인은 이 규칙이
 *    `KO_EN_RULES` 안에만 있었던 것 — 영어로 보낼 때만 걸리고 나머지 언어는 통과했다.
 *    "사과가 여러 번이면 한 번으로"는 언어에 의존하지 않는 중복 제거이므로 공용이어야 한다.
 */
test('🔴 사과 압축 규칙이 모든 언어쌍에 실린다', async () => {
  const { buildRefinePayload } = await import('../src/core/refine/prompt.js');
  const pairs = [
    ['ko', 'en'], ['ko', 'de'], ['ko', 'zh'], ['ko', 'ja'],
    ['ko', 'fr'], ['ko', 'es'], ['en', 'ko'],
  ];
  for (const [sourceLanguage, targetLanguage] of pairs) {
    const { instruction } = buildRefinePayload({
      text: '늦어서 죄송하고, 정말 죄송합니다.',
      sourceLanguage,
      targetLanguage,
      referenceDate: '2026-08-17',
    });
    assert.match(
      instruction,
      /AT MOST\s+ONE apology IN TOTAL/,
      `${sourceLanguage}→${targetLanguage}에 사과 압축 규칙이 없다`,
    );
    assert.match(
      instruction,
      /Never add an apology that is not present/,
      `${sourceLanguage}→${targetLanguage}에 "없는 사과 만들지 말 것"이 없다`,
    );
    // 🔴 v11 실측에서 「한 문장에 쉼표로 두 개」가 규칙을 빠져나갔다 — 그 구멍을 계약으로 막는다.
    assert.match(
      instruction,
      /still counts as two/,
      `${sourceLanguage}→${targetLanguage}에 "쉼표로 합쳐도 두 개다"가 없다`,
    );
  }
});
