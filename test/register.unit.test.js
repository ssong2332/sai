/**
 * 문체 수위(격식체) 계약 — 2026-08-18 신설.
 *
 * 🔴 **왜 생겼나.** 한국어→영어에 격식 손잡이가 **아예 없었다.** `honorificLevel`은
 *    `enKoRules`(영→한)에서만 쓰이고 `KO_EN_RULES`에는 격식 지시가 한 줄도 없다. 그래서 가장
 *    정중한 조합(LOW + 캐주얼 OFF)조차 `Could we discuss… when you get a chance?`에 머물렀고,
 *    고객사에 보낼 `I would like to… Would it be possible to…` 수위에 도달할 수 없었다.
 *    캐주얼 OFF는 「가볍게 하지 마라」일 뿐 「격식을 갖춰라」가 아니다 — 방향이 하나뿐이었다.
 *
 * 🔴 **Spec 필수 9(사람에게 등급 금지)가 걸린 기능이다.** 저장·전송되는 것이 「이 사람은
 *    윗사람」이 아니라 **「이 상대에게는 격식체로 쓴다」**인지를 테스트가 직접 확인한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECIPIENT_REGISTERS,
  REGISTER_LABELS,
  toRefinePayloadRecipient,
} from '../src/lib/recipients.js';
import { buildRefinePayload } from '../src/core/refine/prompt.js';

/* ── 데이터 계약 ─────────────────────────────────────────────── */

test('🔴 직급·서열을 뜻하는 값이 존재하지 않는다 (Spec 필수 9)', () => {
  const banned = ['senior', 'boss', 'manager', 'superior', 'rank', 'level', 'vip', 'junior'];
  for (const code of RECIPIENT_REGISTERS) {
    for (const b of banned) {
      assert.ok(!code.toLowerCase().includes(b), `register 값 "${code}"가 직급을 뜻한다`);
    }
  }
});

test('🔴 화면 문구가 사람이 아니라 **문장**을 서술한다', () => {
  for (const code of RECIPIENT_REGISTERS) {
    const label = REGISTER_LABELS[code];
    assert.ok(label, `${code}에 라벨이 없다`);
    for (const b of ['윗사람', '상사', '높은', '직급', '서열']) {
      assert.ok(!label.includes(b), `라벨 "${label}"이 사람을 평가한다`);
    }
  }
});

test('🔴 세 칸이 모두 존재한다 — casual / 기본(null) / formal', () => {
  assert.deepEqual([...RECIPIENT_REGISTERS].sort(), ['casual', 'formal']);
  assert.ok(REGISTER_LABELS.casual && REGISTER_LABELS.formal, '라벨이 빠졌다');
});

test('🔴 비공개여도 문체는 나간다 — 언어와 같은 성격이다', () => {
  /**
   * 태그는 «관찰된 소통 습관»이라 비공개면 나가지 않는다. 문체는 «어떻게 쓸지»라서 그 사람에
   * 대한 판단이 아니다 — 언어를 비공개와 무관하게 싣는 것과 같은 이유다.
   */
  const out = toRefinePayloadRecipient({
    private: true, register: 'formal', tagIds: ['prefers-direct'],
  });
  assert.equal(out?.register, 'formal', '비공개라고 문체까지 빠졌다');
  assert.equal(out?.tags, undefined, '비공개인데 태그가 나갔다');
});

test('목록 밖 값은 버린다 — 프롬프트로 그대로 나가는 값이다', () => {
  assert.equal(toRefinePayloadRecipient({ register: 'boss' }), null);
  assert.equal(toRefinePayloadRecipient({ register: 'CASUAL' }), null);
  assert.equal(toRefinePayloadRecipient({ register: 'FORMAL' }), null);
});

test('설정하지 않으면 아무것도 싣지 않는다', () => {
  assert.equal(toRefinePayloadRecipient({ register: null, tagIds: [] }), null);
});

/* ── 프롬프트 계약 — 3단 하나의 눈금 ───────────────────────── */

const BASE = {
  text: '배포 일정을 조율해야 합니다.',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-18',
  userUrgency: 'NORMAL',
};
const instructionFor = (register) => buildRefinePayload({ ...BASE, register }).instruction;

test('🔴 세 칸의 지시문이 서로 다르다 — 같으면 버튼이 화면에만 있는 것이다', () => {
  const c = instructionFor('casual');
  const d = instructionFor(null);
  const f = instructionFor('formal');
  assert.notEqual(c, d);
  assert.notEqual(d, f);
  assert.notEqual(c, f);
});

test('🔴 「기본」에도 지시가 실린다 — 비워 두면 모델이 알아서 하고 결과가 안 정해진다', () => {
  /**
   * 예전 기본값은 «아무 지시 없음»이었다. 그래서 「기본」이 무엇인지 아무도 몰랐고,
   * 격식/캐주얼이 무엇으로부터 얼마나 달라지는지도 정의되지 않았다.
   */
  const d = instructionFor(null);
  assert.match(d, /DEFAULT REGISTER/);
  assert.match(d, /NOT letter-formal/, '「메일 격식은 아니다」가 빠졌다');
});

test('🔴 «무엇을 바꿀지»가 칸마다 구체적이다', () => {
  assert.match(instructionFor('formal'), /Would it be possible to/, '격식에 간접 요청 예시가 없다');
  assert.match(instructionFor('formal'), /full forms over contractions/, '격식에 축약형 회피가 없다');
  assert.match(instructionFor('casual'), /contractions/, '캐주얼에 축약형 지시가 없다');
});

test('🔴 앞선 「격식 유지」 지시를 넘어선다고 명시한다', () => {
  assert.match(instructionFor('formal'), /THIS OVERRIDES any earlier instruction about which register/);
});

test('🔴 문체 규칙이 「완충/격식」 금지 **뒤**에 온다 — 배치가 곧 우선순위다', () => {
  const f = instructionFor('formal');
  const banAt = f.indexOf('Do NOT add softening hedges');
  const regAt = f.indexOf('REGISTER (chosen by the user)');
  assert.ok(banAt >= 0 && regAt >= 0, '테스트가 낡았다 — 두 지점을 못 찾았다');
  assert.ok(regAt > banAt, '문체 규칙이 앞에 있다 — 뒤의 금지가 이겨서 무효가 된다');
});

test('🔴 문체가 긴급도 **뒤**에 온다 — 앞에 두면 긴급도가 문체를 덮어쓴다', () => {
  /**
   * 2026-08-18 실측: 긴급도 NORMAL 지시문의 "neutral professional register"가 뒤에서
   * 격식 지시를 덮어써 **격식 토글이 통째로 무효**였다. 배치로 축을 갈라 둔다.
   */
  const f = instructionFor('formal');
  assert.ok(f.indexOf('REGISTER (chosen by the user)') > f.indexOf('URGENCY LEVEL CHOSEN'));
});

test('🔴 어느 칸이든 사실은 안 바뀐다', () => {
  for (const r of ['casual', null, 'formal']) {
    assert.match(
      instructionFor(r),
      /keep every deadline, number, and required action exactly as stated/,
      `${r ?? '기본'}에 사실 보존 조항이 없다`,
    );
  }
});

test('🔴 문체가 «압박»은 건드리지 않는다고 못 박는다', () => {
  assert.match(instructionFor('formal'), /Do NOT change how urgent or pressing/);
});

test('🔴 출력에 상대의 직급·서열을 언급하지 말라고 못 박는다 (Spec 필수 9)', () => {
  for (const r of ['casual', null, 'formal']) {
    assert.match(instructionFor(r), /seniority, rank, or status/);
  }
});
