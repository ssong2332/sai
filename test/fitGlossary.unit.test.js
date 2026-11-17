/**
 * 2026-11-17 점검 — 확장이 보내는 용어집이 서버 상한(`MAX_GLOSSARY_ENTRIES`)을 넘지 않는다.
 * 🔴 예전엔 팀 용어를 개수 제한 없이 실어, 팀원 누가 301번째 용어를 넣으면 팀 전원의 다듬기가 400(glossary-too-long)으로 실패했다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fitGlossary, MAX_GLOSSARY_ENTRIES, MAX_GLOSSARY_TERM_CHARS } from '../src/core/refine/limits.js';

const make = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, sourceText: `${prefix}${i}`, targetText: 'x' }));

test('개인 + 팀이 상한을 넘으면 개인을 먼저 두고 팀은 남은 자리만큼', () => {
  const { personal, team } = fitGlossary(make('p', 10), make('t', 400));
  assert.equal(personal.length, 10);
  assert.equal(personal.length + team.length, MAX_GLOSSARY_ENTRIES);
  assert.equal(team[0].id, 't0', '팀 용어는 앞에서부터');
});

test('무료 개인 상한(5)을 적용하고, 개인만으로도 서버 상한을 넘지 않는다', () => {
  assert.equal(fitGlossary(make('p', 9), [], 5).personal.length, 5);
  assert.equal(fitGlossary(make('p', 500), make('t', 3)).personal.length, MAX_GLOSSARY_ENTRIES);
  assert.equal(fitGlossary(make('p', 500), make('t', 3)).team.length, 0);
});

test('서버가 빼는 긴 용어는 미리 뺀다(원문유지 null은 그대로)', () => {
  const long = { id: 'long', sourceText: 'a'.repeat(MAX_GLOSSARY_TERM_CHARS + 1), targetText: 'x' };
  const keep = { id: 'keep', sourceText: 'API', targetText: null };
  const { personal, team } = fitGlossary([long, keep], [{ ...long, id: 'tlong' }]);
  assert.deepEqual(personal.map((e) => e.id), ['keep']);
  assert.deepEqual(team, []);
});
