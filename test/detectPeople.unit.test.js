/**
 * 대화 상대 후보 감지 (2026-08-16 ⑦⑧).
 *
 * 🔴 이 테스트가 지키는 것: **아무 낱말이나 이름으로 집지 않는다.** 잘못 집으면 사용자가
 *    모르는 사람을 등록하게 되고 그 이름으로 언어·태그가 붙는다. 못 찾으면 빈손이 낫다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectSpeakerNames, matchRecipient } from '../src/content/detectPeople.js';

test('`이름: 내용` 꼴에서 발화자를 뽑는다', () => {
  const lines = ['Sarah: Could you review the PR?', 'Miguel: I will take a look.'];
    assert.deepEqual(detectSpeakerNames(lines), ['Sarah', 'Miguel']);
});

test('한국어 콜론(：)도 읽는다', () => {
  assert.deepEqual(detectSpeakerNames(['홍길동：자료 확인 부탁드립니다']), ['홍길동']);
});

test('메일 헤더 꼴 `이름 <메일>`도 읽는다', () => {
  assert.deepEqual(detectSpeakerNames(['Sarah Kim <sarah@acme.com>']), ['Sarah Kim']);
});

test('자주 나온 순으로 돌려준다', () => {
  const lines = ['Bob: a', 'Ann: b', 'Ann: c', 'Ann: d'];
  assert.equal(detectSpeakerNames(lines)[0], 'Ann');
});

/* ── 🔴 집으면 안 되는 것들 ─────────────────────────────────────────── */

test('🔴 시각을 이름으로 집지 않는다', () => {
  assert.deepEqual(detectSpeakerNames(['14:30 회의 시작합니다']), []);
});

test('🔴 URL을 이름으로 집지 않는다', () => {
  assert.deepEqual(detectSpeakerNames(['https://example.com/docs 확인해 주세요']), []);
});

test('🔴 티켓 번호로 시작하는 줄을 집지 않는다', () => {
  assert.deepEqual(detectSpeakerNames(['482: 로그인 오류']), []);
});

test('🔴 문장을 이름으로 집지 않는다 — 낱말 4개 초과', () => {
  assert.deepEqual(detectSpeakerNames(['오늘 회의 자료 정리해서 공유: 첨부 확인']), []);
});

test('🔴 물음표·느낌표가 든 조각은 이름이 아니다', () => {
  assert.deepEqual(detectSpeakerNames(['확인하셨나요?: 네']), []);
});

test('🔴 말줄임이 든 잘린 조각을 집지 않는다', () => {
  assert.deepEqual(detectSpeakerNames(['그래서 말인데…: 어때요']), []);
});

test('머리말(Re·FW·공지)은 이름이 아니다', () => {
  assert.deepEqual(detectSpeakerNames(['Re: 일정 조율', 'FW: 자료', '공지: 서버 점검']), []);
});

test('내용이 없는 줄은 세지 않는다 — `이름:` 만 있는 줄', () => {
  assert.deepEqual(detectSpeakerNames(['Sarah:']), []);
});

test('빈 입력에도 죽지 않는다', () => {
  assert.deepEqual(detectSpeakerNames(null), []);
  assert.deepEqual(detectSpeakerNames([]), []);
});

/* ── 등록된 수신자와의 대조 ─────────────────────────────────────────── */

const PEOPLE = [
  { id: 'r1', name: 'Sarah' },
  { id: 'r2', name: '홍길동' },
];

test('등록된 사람과 이름이 같으면 자동 선택 대상이다', () => {
  const out = matchRecipient(['Sarah'], PEOPLE);
  assert.equal(out.matchedId, 'r1');
  assert.deepEqual(out.suggestions, []);
});

test('대소문자·공백 차이는 같은 사람으로 본다', () => {
  assert.equal(matchRecipient([' sarah '], PEOPLE).matchedId, 'r1');
});

test('🔴 등록되지 않은 후보는 자동 선택하지 않고 제안만 한다', () => {
  const out = matchRecipient(['Miguel'], PEOPLE);
  assert.equal(out.matchedId, null);
  assert.deepEqual(out.suggestions, ['Miguel']);
});

test('등록된 사람이 하나라도 있으면 그쪽이 이긴다 — 제안보다 확실한 정보다', () => {
  assert.equal(matchRecipient(['Miguel', 'Sarah'], PEOPLE).matchedId, 'r1');
});

test('후보가 없으면 아무것도 제안하지 않는다', () => {
  assert.deepEqual(matchRecipient([], PEOPLE).suggestions, []);
});

test('🔴 후보가 여럿이면 여럿을 준다 — 하나만 내밀면 엉뚱한 사람이 제안된다 (2026-08-16)', () => {
  const out = matchRecipient(['Ann', 'Bob', 'Cara'], PEOPLE);
  assert.deepEqual(out.suggestions, ['Ann', 'Bob', 'Cara']);
});

/* ── 이름이 자기 줄에 따로 있는 구조 (2026-08-16 실측이 잡은 누락) ────── */

test('🔴 이름이 별도 줄에 있어도 잡는다 — Slack·Teams 등 대부분의 화면 구조다', () => {
  const lines = ['제이미', '컴펌확인해주세요', '배포는 반드시 오늘까지 해야 합니다 정말 죄송합니다'];
  assert.deepEqual(detectSpeakerNames(lines), ['제이미']);
});

test('🔴 문장으로 끝나는 짧은 줄은 이름이 아니다 — 「컴펌확인해주세요」가 등록되면 안 된다', () => {
  assert.deepEqual(detectSpeakerNames(['컴펌확인해주세요', '배포는 오늘까지 해야 합니다 죄송합니다']), []);
});

test('🔴 다음 줄이 더 짧으면 집지 않는다 — 이름 위에 본문이 오지는 않는다', () => {
  assert.deepEqual(detectSpeakerNames(['홍길동', '네']), []);
});
