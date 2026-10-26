/**
 * 티켓 적용 글 조립 (2026-10-27 A안) — 「다음 할 일」 머리말 · 「없음」 칸 생략.
 * 🔴 Lessons #1 — green이어도 실확장 확인을 대신하지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTicketText, TICKET_SECTIONS } from '../src/content/ticketText.js';

test('세 번째 칸은 「다음 할 일」 / [Next step]이다 — 예전 「요청사항」/[Request]가 아니다', () => {
  assert.deepEqual(
    TICKET_SECTIONS.map((s) => [s.label, s.tag]),
    [
      ['문제점', 'Issue'],
      ['영향', 'Impact'],
      ['다음 할 일', 'Next step'],
    ],
  );
});

test('세 칸이 다 있으면 세 줄로 조립한다', () => {
  const text = formatTicketText({
    problem: 'The schedule slipped again.',
    impact: 'Release may move.',
    request: 'I will re-share the plan by Friday.',
    concernLevel: '피로감',
  });
  assert.equal(
    text,
    '[Issue] The schedule slipped again.\n[Impact] Release may move.\n[Next step] I will re-share the plan by Friday.',
  );
});

test('「없음」 칸은 상대에게 보내는 글에 넣지 않는다', () => {
  const text = formatTicketText({
    problem: 'The schedule slipped again.',
    impact: '없음',
    request: 'I will re-share the plan by Friday.',
    concernLevel: '피로감',
  });
  assert.equal(text, '[Issue] The schedule slipped again.\n[Next step] I will re-share the plan by Friday.');
  assert.doesNotMatch(text, /없음/);
});

test('우려 수준(메타)은 적용 글에 들어가지 않는다', () => {
  const text = formatTicketText({ problem: 'p', impact: 'i', request: 'r', concernLevel: '강한 답답함' });
  assert.doesNotMatch(text, /답답함/);
});
