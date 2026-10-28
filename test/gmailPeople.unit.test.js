/**
 * Gmail 대화 상대 후보 (2026-10-28 판정표 G1~G7 · 읽기 규칙 R1~R6 · S1).
 *
 * 🔴 이 테스트가 지키는 것: Gmail에서는 **사람 요소만** 후보가 된다. 주소에서 이름을 지어내지 않고,
 *    나 자신과 참조는 빠진다. DOM 읽기(`collectGmailPeople`)는 실브라우저에서만 확인한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { pickGmailPeople, stripAffiliation, collectGmailPeople } from '../src/content/gmailPeople.js';

const SELF = 'zxc@ptu.ac.kr';

test('S1 — 이름 맨 앞의 「(소속)」을 뗀다 (2026-10-28 실측 꼴)', () => {
  assert.equal(stripAffiliation('(반도체디스플레이장비운영학과)박선후'), '박선후');
  assert.equal(stripAffiliation('(IT공과대학 정보통신학과)변진욱'), '변진욱');
  assert.equal(stripAffiliation('(부설기관 PTU교육혁신원 교수학습지원센터)이주희'), '이주희');
  assert.equal(stripAffiliation('（전각）홍길동'), '홍길동');
});

test('🔴 S1 — 떼고 남는 게 없으면 떼지 않는다 · 가운데 괄호는 그대로', () => {
  assert.equal(stripAffiliation('(마케팅팀)'), '(마케팅팀)');
  assert.equal(stripAffiliation('Sarah (Acme)'), 'Sarah (Acme)');
  assert.equal(stripAffiliation('Sarah Kim'), 'Sarah Kim');
});

test('R1 — 받는사람 칩의 이름을 후보로 낸다 (소속을 떼고)', () => {
  const toChips = [{ name: '(반도체디스플레이장비운영학과)박선후', email: 'p@ptu.ac.kr' }];
  assert.deepEqual(pickGmailPeople({ toChips }), ['박선후']);
});

test('R1 — 받는사람이 여럿이면 최대 3명, 같은 이름은 한 번', () => {
  const toChips = ['A', 'B', 'B', 'C', 'D'].map((name, i) => ({ name, email: `${i}@x.com` }));
  assert.deepEqual(pickGmailPeople({ toChips }), ['A', 'B', 'C']);
});

test('🔴 R2 — 주소뿐인 칩은 후보가 아니다 (fooi1004@hanmail.net 실측)', () => {
  const toChips = [{ name: 'fooi1004@hanmail.net', email: 'fooi1004@hanmail.net' }];
  assert.deepEqual(pickGmailPeople({ toChips }), []);
  assert.deepEqual(pickGmailPeople({ toChips: [{ name: '', email: 'a@b.com' }] }), []);
});

test('🔴 R2 — 받는사람 칩이 주소뿐이어도 보낸사람으로 넘어가지 않는다', () => {
  const toChips = [{ name: 'fooi1004@hanmail.net', email: 'fooi1004@hanmail.net' }];
  const senders = [{ name: '(IT공과대학 정보통신학과)변진욱', email: 'j@ptu.ac.kr' }];
  assert.deepEqual(pickGmailPeople({ toChips, senders }), []);
});

test('R3 — 받는사람 칩이 없으면 열린 메일의 마지막 보낸사람', () => {
  const senders = [
    { name: 'Ann', email: 'ann@x.com' },
    { name: '(IT공과대학 정보통신학과)변진욱', email: 'j@ptu.ac.kr' },
  ];
  assert.deepEqual(pickGmailPeople({ senders }), ['변진욱']);
});

test('🔴 R4 — 나 자신은 빠진다 · 내가 마지막에 답했으면 그 앞 사람', () => {
  const senders = [
    { name: '(IT공과대학 정보통신학과)변진욱', email: 'j@ptu.ac.kr' },
    { name: '박수홍', email: SELF },
  ];
  assert.deepEqual(pickGmailPeople({ senders, selfEmails: [SELF] }), ['변진욱']);
  assert.deepEqual(pickGmailPeople({ toChips: [{ name: '박수홍', email: 'ZXC@ptu.ac.kr' }], selfEmails: [SELF] }), []);
});

test('빈 입력·DOM 없음에도 죽지 않는다', () => {
  assert.deepEqual(pickGmailPeople(), []);
  assert.deepEqual(pickGmailPeople({ toChips: [null, {}] }), []);
  assert.deepEqual(collectGmailPeople(null), []);
});
