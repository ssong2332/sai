/**
 * L34 — 팀 맥락 카운트 6종 (2026-10-25 사용자 승인).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 키 집합이 확장(`FRICTION_EVENTS`) · 서버(`COUNT_KEYS`) · 대시보드(`EVENT_IDS`) 세 곳에서 같다
 *    ② `context` 키는 건강도 지수를 바꾸지 않고, 대시보드 긍정·마찰 목록에 섞이지 않는다
 *    ③ 세는 순간(판정표) — 폴백은 세지 않고, 긴급도 `fallback`은 분포에 넣지 않는다
 *    ④ 팀 용어는 scope=team 항목이 **교정문에서 확인됐을 때만** 센다
 *    ⑤ 「예약 알림 저장」은 새 키 없이 기존 `schedule`이 맡는다
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRICTION_EVENTS,
  EVENT_POLARITY,
  EVENT_LABELS,
  healthIndex,
  refineContextEvents,
  decodeEvents,
  hasAppliedTeamGlossary,
} from '../src/lib/friction.js';
import { COUNT_KEYS } from '../functions/teams.js';
import {
  EVENT_IDS,
  CONTEXT_IDS,
  POSITIVE_IDS,
  FRICTION_IDS,
  readLiveScenarios,
} from '../dashboard/src/liveData.js';

const NEW_KEYS = [
  'decoded',
  'decodeUrgencyGap',
  'urgencyCritical',
  'urgencyNormal',
  'urgencyLow',
  'teamGlossaryApplied',
];

/* ── ① 계약: 세 곳의 키 집합 ─────────────────────────────────────────── */

test('🔴 확장 · 서버 · 대시보드의 키 집합이 같다 (refined 분모는 대시보드에서 따로 읽는다)', () => {
  const extension = Object.values(FRICTION_EVENTS).sort();
  assert.deepEqual([...COUNT_KEYS].sort(), extension);
  // 대시보드는 `refined`를 막대 행이 아니라 `total`로 읽는다 — 그 하나만 빠진다.
  assert.deepEqual([...EVENT_IDS, 'refined'].sort(), extension);
});

test('새 키 6종이 모두 context 극성 · 화면 문구를 갖는다', () => {
  for (const key of NEW_KEYS) {
    assert.ok(Object.values(FRICTION_EVENTS).includes(key), `${key}: 확장 계약에 없음`);
    assert.equal(EVENT_POLARITY[key], 'context', `${key}: 극성`);
    assert.equal(typeof EVENT_LABELS[key], 'string');
  }
  assert.deepEqual([...CONTEXT_IDS].sort(), [...NEW_KEYS].sort());
});

test('🔴 「예약 알림 저장」 키를 따로 만들지 않는다 — `schedule`이 그 순간이다', () => {
  assert.ok(!Object.values(FRICTION_EVENTS).includes('reservationSaved'));
  assert.ok(Object.values(FRICTION_EVENTS).includes('schedule'));
});

/* ── ② 건강도 지수 · 대시보드 막대 불변 ─────────────────────────────── */

test('🔴 context 카운트가 아무리 많아도 건강도 지수는 그대로다', () => {
  const base = { refined: 100, misread: 6, venting: 2, forceOffHours: 1, clear: 5 };
  const withContext = { ...base };
  for (const key of NEW_KEYS) withContext[key] = 999;
  assert.equal(healthIndex(base), 91);
  assert.equal(healthIndex(withContext), 91);
});

test('🔴 대시보드 긍정·마찰 목록에 context 키가 섞이지 않는다', () => {
  for (const key of NEW_KEYS) {
    assert.ok(!POSITIVE_IDS.includes(key), `${key}가 긍정에 들어감`);
    assert.ok(!FRICTION_IDS.includes(key), `${key}가 마찰에 들어감`);
  }
});

test('#sai= 페이로드의 새 키가 시나리오 `context`로 살아 넘어온다 · 막대 합계는 그대로', () => {
  const counts = { refined: 10, misread: 2, clear: 1, decoded: 4, urgencyCritical: 3, teamGlossaryApplied: 2, bogus: 7 };
  const json = JSON.stringify({ teams: [{ teamId: 't1', teamName: '팀', counts, byDate: {} }] });
  const hash = `#sai=${btoa(unescape(encodeURIComponent(json)))}`;
  const [scenario] = readLiveScenarios(hash);
  const byId = Object.fromEntries(scenario.context.map((row) => [row.id, row.count]));
  assert.equal(byId.decoded, 4);
  assert.equal(byId.urgencyCritical, 3);
  assert.equal(byId.teamGlossaryApplied, 2);
  assert.equal(byId.urgencyLow, 0);
  assert.equal(scenario.total, 10);
  assert.equal(scenario.positive.reduce((s, r) => s + r.count, 0), 1);
  assert.equal(scenario.friction.reduce((s, r) => s + r.count, 0), 2);
  // 화이트리스트 밖 키는 어디에도 없다.
  const allIds = [...scenario.positive, ...scenario.friction, ...scenario.context].map((r) => r.id);
  assert.ok(!allIds.includes('bogus'));
});

/* ── ③ 세는 순간 — 다듬기 ───────────────────────────────────────────── */

test('다듬기 성공: 최종 긴급도 하나를 센다 — 사용자가 골랐든 AI가 골랐든', () => {
  assert.deepEqual(refineContextEvents({ urgency: 'CRITICAL', urgencySource: 'ai' }), ['urgencyCritical']);
  assert.deepEqual(refineContextEvents({ urgency: 'LOW', urgencySource: 'user', aiUrgency: 'CRITICAL' }), ['urgencyLow']);
  assert.deepEqual(refineContextEvents({ urgency: 'NORMAL', urgencySource: 'ai' }), ['urgencyNormal']);
});

test('🔴 폴백 응답은 아무것도 세지 않는다', () => {
  assert.deepEqual(
    refineContextEvents({ urgency: 'NORMAL', urgencySource: 'fallback', fallback: true }, { teamGlossaryApplied: true }),
    [],
  );
  assert.deepEqual(refineContextEvents(null), []);
});

test('🔴 긴급도 판정 실패(urgencySource=fallback)로 채운 NORMAL은 분포에 넣지 않는다', () => {
  assert.deepEqual(refineContextEvents({ urgency: 'NORMAL', urgencySource: 'fallback', fallback: false }), []);
});

test('목록 밖 긴급도 값은 세지 않는다', () => {
  assert.deepEqual(refineContextEvents({ urgency: 'URGENT', urgencySource: 'ai' }), []);
});

test('팀 용어 적용은 메시지당 1건 — 불리언이 true일 때만', () => {
  assert.deepEqual(
    refineContextEvents({ urgency: 'LOW', urgencySource: 'ai' }, { teamGlossaryApplied: true }),
    ['urgencyLow', 'teamGlossaryApplied'],
  );
  assert.deepEqual(refineContextEvents({ urgency: 'LOW', urgencySource: 'ai' }, { teamGlossaryApplied: false }), ['urgencyLow']);
});

/* ── ③ 세는 순간 — 뜻 풀기 ──────────────────────────────────────────── */

test('뜻 풀기 성공: decoded는 항상, 격차가 있으면 decodeUrgencyGap도', () => {
  assert.deepEqual(decodeEvents({ urgencyGap: false, fallback: false }), ['decoded']);
  assert.deepEqual(decodeEvents({ urgencyGap: true, fallback: false }), ['decoded', 'decodeUrgencyGap']);
});

test('🔴 뜻 풀기 폴백은 세지 않는다', () => {
  assert.deepEqual(decodeEvents({ urgencyGap: true, fallback: true }), []);
  assert.deepEqual(decodeEvents(undefined), []);
});

/* ── ④ 팀 용어 판정 ─────────────────────────────────────────────────── */

const GLOSSARY = [
  { id: 'p1', scope: 'personal', sourceText: '김 대리님', targetText: 'Sujin Kim' },
  { id: 't1', scope: 'team', sourceText: '배포', targetText: 'release' },
];

test('팀 항목이 교정문에서 확인되면 true', () => {
  const response = {
    refined: 'The release is tomorrow.',
    appliedGlossary: [{ id: 't1', sourceText: '배포', appliedText: 'release' }],
  };
  assert.equal(hasAppliedTeamGlossary(response, GLOSSARY), true);
});

test('개인 항목만 적용됐으면 false', () => {
  const response = {
    refined: 'Sujin Kim will check.',
    appliedGlossary: [{ id: 'p1', sourceText: '김 대리님', appliedText: 'Sujin Kim' }],
  };
  assert.equal(hasAppliedTeamGlossary(response, GLOSSARY), false);
});

test('🔴 모델이 팀 항목을 신고했지만 교정문에 없으면 false (N-02 — 자기 신고는 증거가 아니다)', () => {
  const response = {
    refined: 'The deployment is tomorrow.',
    appliedGlossary: [{ id: 't1', sourceText: '배포', appliedText: 'release' }],
  };
  assert.equal(hasAppliedTeamGlossary(response, GLOSSARY), false);
});

test('id가 비어 있으면 팀/개인을 가를 수 없다 — 세지 않는다', () => {
  const response = {
    refined: 'The release is tomorrow.',
    appliedGlossary: [{ id: '', sourceText: '배포', appliedText: 'release' }],
  };
  assert.equal(hasAppliedTeamGlossary(response, GLOSSARY), false);
});

test('요청에 팀 항목이 없거나 폴백이면 false', () => {
  const response = {
    refined: 'The release is tomorrow.',
    appliedGlossary: [{ id: 't1', sourceText: '배포', appliedText: 'release' }],
  };
  assert.equal(hasAppliedTeamGlossary(response, [GLOSSARY[0]]), false);
  assert.equal(hasAppliedTeamGlossary({ ...response, fallback: true }, GLOSSARY), false);
  assert.equal(hasAppliedTeamGlossary(response, undefined), false);
});
