/**
 * L28 안전망 — 용어집 신고 대조(A) · 「누가 할 일인가」 비교(B) (2026-10-23).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 실측 결함을 잡는다 — N-02(용어집 거짓 신고 · 3인칭 전달 → 요청), L28(약속 → 요청).
 *    ② **멀쩡한 결과를 잡지 않는다** — 부탁 → 부탁, 약속 → 약속, 영어 원문, 폴백, 빈 역번역.
 *       오탐이 잦으면 경고 자체를 안 읽게 된다(S42·S44).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkGlossaryApplied, glossaryWarningText } from '../src/core/refine/glossaryCheck.js';
import {
  checkIntentDrift,
  classifySentence,
  findIntentDrift,
  intentDriftWarningText,
} from '../src/core/refine/intentDrift.js';

const N02_REFINED =
  'Could you please review this when you have a moment? Your confirmation is needed.';

// ── A. 용어집 신고 대조 ─────────────────────────────────────────────────
test('🔴 실측 N-02 — 신고한 「Sujin Kim」이 교정문에 없으면 적용됨에서 빼고 경고한다', () => {
  const out = checkGlossaryApplied({
    refined: N02_REFINED,
    appliedGlossary: [{ id: 'g2', sourceText: '김 대리님', appliedText: 'Sujin Kim' }],
  });
  assert.deepEqual(out.applied, []);
  assert.deepEqual(out.missing, ['Sujin Kim']);
  assert.match(glossaryWarningText(out.missing), /「Sujin Kim」이\(가\) 교정문에 반영되지 않았어요/);
});

test('A — 교정문에 있으면(대소문자·공백 무시) 적용됨으로 남고 경고 없음', () => {
  const entry = { id: 'g2', sourceText: '김 대리님', appliedText: 'Sujin Kim' };
  const out = checkGlossaryApplied({
    refined: 'Could SUJIN  KIM please review this?',
    appliedGlossary: [entry],
  });
  assert.deepEqual(out.applied, [entry]);
  assert.deepEqual(out.missing, []);
});

test('A — 섞여 있으면 있는 것만 적용됨, 없는 것만 경고(중복 신고는 한 번만)', () => {
  const ok = { id: 'g1', sourceText: '배포', appliedText: 'release' };
  const bad = { id: 'g2', sourceText: '김 대리님', appliedText: 'Sujin Kim' };
  const out = checkGlossaryApplied({
    refined: 'The release is ready.',
    appliedGlossary: [ok, bad, { ...bad, id: 'g3', appliedText: 'sujin kim' }],
  });
  assert.deepEqual(out.applied, [ok]);
  assert.deepEqual(out.missing, ['Sujin Kim']);
});

test('A — appliedText가 비면 적용됨으로 세지도, 경고하지도 않는다', () => {
  const out = checkGlossaryApplied({
    refined: 'Hello.',
    appliedGlossary: [{ id: 'g1', sourceText: '안녕', appliedText: '' }],
  });
  assert.deepEqual(out, { applied: [], missing: [] });
});

test('A — 폴백·빈 결과는 검사하지 않는다', () => {
  assert.deepEqual(
    checkGlossaryApplied({
      fallback: true,
      refined: '원문',
      appliedGlossary: [{ id: 'g', sourceText: 'x', appliedText: 'Y' }],
    }),
    { applied: [], missing: [] },
  );
  assert.deepEqual(checkGlossaryApplied(null), { applied: [], missing: [] });
  assert.equal(glossaryWarningText([]), '');
});

// ── B. 「누가 할 일인가」 — 문장 분류 ──────────────────────────────────
test('B 분류 — 확실한 끝맺음만 분류한다', () => {
  assert.equal(classifySentence('재발 방지 테스트 추가를 확인하겠습니다.'), 'commitment');
  assert.equal(classifySentence('내일까지 보내 드릴게요!'), 'commitment');
  assert.equal(classifySentence('제가 정리해 볼게요 ^^'), 'commitment');
  assert.equal(classifySentence('확인해 주실 수 있나요?'), 'request');
  assert.equal(classifySentence('검토해 주시겠어요?'), 'request');
  assert.equal(classifySentence('내일 오전까지 리뷰 부탁드립니다'), 'request');
  assert.equal(classifySentence('자료 공유 부탁드릴게요'), 'request');
  assert.equal(classifySentence('김 대리님이 확인해 주셔야 합니다.'), 'relay');
  assert.equal(classifySentence('디자인팀이 시안을 수정해야 합니다.'), 'relay');
  // 판단·인사·추측·질문은 약속이 아니다
  assert.equal(classifySentence('알겠습니다.'), 'unknown');
  assert.equal(classifySentence('감사하겠습니다.'), 'unknown');
  assert.equal(classifySentence('그렇게 하면 되겠습니다.'), 'unknown');
  assert.equal(classifySentence('회의에 참석하시겠습니다.'), 'unknown');
  assert.equal(classifySentence('오늘 안에 확인하겠어요?'), 'unknown');
  assert.equal(classifySentence('확인이 필요합니다.'), 'unknown');
  // 의무지만 3인칭 주어가 없으면 누구 일인지 모른다
  assert.equal(classifySentence('오늘까지 제출해야 합니다.'), 'unknown');
});

// ── B. 실측 결함 ───────────────────────────────────────────────────────
test('🔴 실측 L28 — 「확인하겠습니다」(약속) → 「확인해 주실 수 있나요?」(요청)를 잡는다', () => {
  const drift = checkIntentDrift(
    {
      sourceLanguage: 'ko',
      backTranslation: '로그를 공유해 주셔서 감사합니다. 재발 방지 테스트 추가를 확인해 주실 수 있나요?',
    },
    '로그 공유 감사합니다. 재발 방지 테스트 추가를 확인하겠습니다.',
  );
  assert.deepEqual(drift, ['commitment']);
  assert.match(intentDriftWarningText(drift[0]), /원문은 「제가 하겠다」인데/);
});

test('🔴 실측 N-02 — 「김 대리님이 확인해 주셔야 합니다」(전달) → 수신자에게 요청을 잡는다', () => {
  const drift = checkIntentDrift(
    {
      sourceLanguage: 'ko',
      backTranslation: '김수진 님, 이것을 시간 되실 때 검토해 주시겠어요? 확인이 필요합니다.',
    },
    '김 대리님이 확인해 주셔야 합니다.',
  );
  assert.deepEqual(drift, ['relay']);
  assert.match(intentDriftWarningText(drift[0]), /다른 사람이 할 일을 전하는 말/);
});

// ── B. 경고하면 안 되는 것 ─────────────────────────────────────────────
test('B — 원문이 부탁이면 역번역의 부탁은 정상이다', () => {
  assert.deepEqual(
    findIntentDrift({
      sourceText: '내일 오전까지 리뷰 부탁드립니다',
      backTranslation: '내일 오전까지 검토해 주실 수 있을까요?',
    }),
    [],
  );
  // 🔴 약속 + 부탁이 섞인 원문을 모델이 한 문장으로 합치면 약속 「수」가 줄어든다 —
  //    원문에 부탁이 있으면 판정하지 않는다(오탐 쪽을 막는 가드).
  assert.deepEqual(
    findIntentDrift({
      sourceText: '제가 자료를 정리하겠습니다. 검토 부탁드립니다.',
      backTranslation: '정리한 자료를 검토해 주실 수 있을까요?',
    }),
    [],
  );
});

test('B — 약속이 약속으로 남으면 경고 없음', () => {
  assert.deepEqual(
    findIntentDrift({
      sourceText: '재발 방지 테스트 추가를 확인하겠습니다.',
      backTranslation: '재발 방지 테스트가 추가되었는지 확인하겠습니다.',
    }),
    [],
  );
  // 약속이 남아 있으면 다른 문장에 부탁이 생겨도 「바뀌었다」고 하지 않는다
  assert.deepEqual(
    findIntentDrift({
      sourceText: '제가 확인하겠습니다.',
      backTranslation: '제가 확인하겠습니다. 시간 되실 때 알려 주세요.',
    }),
    [],
  );
});

test('B — 전달이 전달로 남으면 경고 없음', () => {
  assert.deepEqual(
    findIntentDrift({
      sourceText: '김 대리님이 확인해 주셔야 합니다.',
      backTranslation: '김수진 님이 확인해 주셔야 합니다. 시간 되실 때 알려 주세요.',
    }),
    [],
  );
});

test('B — 주어가 수신자 본인이면 전달로 보지 않는다', () => {
  assert.deepEqual(
    findIntentDrift({
      sourceText: '김 대리님이 확인해 주셔야 합니다.',
      backTranslation: '김 대리님, 확인해 주시겠어요?',
      recipientNames: ['김 대리'],
    }),
    [],
  );
});

test('B — 영어 원문·폴백·빈 역번역은 판정하지 않는다', () => {
  const back = '확인해 주실 수 있나요?';
  assert.deepEqual(
    checkIntentDrift({ sourceLanguage: 'en', backTranslation: back }, 'I will check it.'),
    [],
  );
  assert.deepEqual(
    checkIntentDrift({ sourceLanguage: 'ko', fallback: true, backTranslation: back }, '확인하겠습니다.'),
    [],
  );
  assert.deepEqual(checkIntentDrift({ sourceLanguage: 'ko', backTranslation: '' }, '확인하겠습니다.'), []);
  assert.deepEqual(checkIntentDrift({ sourceLanguage: 'ko' }, '확인하겠습니다.'), []);
  assert.deepEqual(checkIntentDrift(null, '확인하겠습니다.'), []);
  assert.equal(intentDriftWarningText('unknown'), '');
});

test('🔴 L28 재현(2026-10-31) — 「공유드릴게요」(약속)가 정중한 요청 끝맺음 4가지로 바뀌어도 잡는다', () => {
  const sourceText = '수정한 계획은 금요일까지 다시 공유드릴게요.';
  for (const backTranslation of [
    '수정된 계획을 금요일까지 다시 공유해 주실 수 있으실까요?',
    '수정된 계획을 금요일까지 다시 공유 부탁드려도 될까요?',
    '수정된 계획을 금요일까지 다시 공유해 주실 수 있으신지요?',
    '금요일까지 업데이트된 계획을 다시 공유해 주실 수 있을지요?',
  ]) {
    assert.deepEqual(findIntentDrift({ sourceText, backTranslation }), ['commitment'], backTranslation);
  }
});

test('L28 재현(2026-10-31) — 원문이 같은 끝맺음으로 부탁하면 경고 없음(새 끝맺음도 원문 요청 가드를 탄다)', () => {
  for (const sourceText of [
    '금요일까지 다시 공유해 주실 수 있으실까요?',
    '금요일까지 다시 공유 부탁드려도 될까요?',
    '금요일까지 다시 공유해 주실 수 있으신지요?',
    '금요일까지 다시 공유해 주실 수 있을지요?',
  ]) {
    assert.deepEqual(
      findIntentDrift({ sourceText, backTranslation: '금요일까지 다시 공유해 주실 수 있나요?' }),
      [],
      sourceText,
    );
  }
});
