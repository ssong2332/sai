/**
 * 개인 용어집 CRUD 단위 테스트 (S12 / Spec 필수 7).
 * `chrome`이 없는 Node 환경이라 `src/lib/storage.js`는 메모리 폴백을 쓴다 — 매 테스트마다
 * `removeLocal`로 초기화해 테스트 간 상태가 섞이지 않게 한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_KEYS, removeLocal, getLocal } from '../src/lib/storage.js';
import {
  listPersonalGlossary,
  addPersonalGlossaryEntry,
  updatePersonalGlossaryEntry,
  removePersonalGlossaryEntry,
  toRefinePayloadGlossary,
} from '../src/lib/glossary.js';

test.beforeEach(async () => {
  await removeLocal(STORAGE_KEYS.GLOSSARY_PERSONAL);
});

/* ── 시작은 빈 목록 ───────────────────────────────────────────────────── */

test('🔴 처음에는 비어 있다 — 등록한 적 없는 용어가 문장을 바꾸면 안 된다', async () => {
  // 2026-08-15: 예전에는 「배포→rollout」 등 4건이 자동으로 심어졌다. 용어집은 교정 결과를
  // 실제로 치환하므로, 사용자가 넣지 않은 규칙이 상대에게 나가는 문장을 고치고 있었다.
  assert.deepEqual(await listPersonalGlossary(), []);
});

test('추가한 뒤 전부 삭제하면 다시 비어 있다 — 무엇도 되살아나지 않는다', async () => {
  await addPersonalGlossaryEntry({ sourceText: '배포', targetText: 'rollout', keepSource: false });
  const list = await listPersonalGlossary();
  for (const entry of list) await removePersonalGlossaryEntry(entry.id);

  const after = await listPersonalGlossary();
  assert.deepEqual(after, []); // 시드 재적용 안 됨 — "삭제됨"과 "한 번도 없음"은 다르다
});

/* ── 생성 ─────────────────────────────────────────────────────────────── */

test('용어를 추가하면 목록 맨 앞에 붙고 저장된다', async () => {
  const entry = await addPersonalGlossaryEntry({ sourceText: 'QA', targetText: 'quality assurance' });
  const list = await listPersonalGlossary();

  assert.equal(list[0].id, entry.id);
  assert.equal(list[0].sourceText, 'QA');
  assert.equal(list[0].targetText, 'quality assurance');
  assert.equal(list[0].keepSource, false);
});

test('[원문 유지]는 targetText를 null로 강제한다 — 입력값이 있어도 무시', async () => {
  const entry = await addPersonalGlossaryEntry({
    sourceText: 'Sai',
    targetText: '이 값은 저장되면 안 됨',
    keepSource: true,
  });
  assert.equal(entry.targetText, null);
});

test('원문이 비어 있으면 거절한다', async () => {
  await assert.rejects(() => addPersonalGlossaryEntry({ sourceText: '  ', targetText: 'x' }));
});

test('[원문 유지]가 아닌데 번역어가 없으면 거절한다', async () => {
  await assert.rejects(() => addPersonalGlossaryEntry({ sourceText: '용어', targetText: '' }));
});

test('앞뒤 공백은 저장 전에 잘린다', async () => {
  const entry = await addPersonalGlossaryEntry({ sourceText: '  QA  ', targetText: '  quality  ' });
  assert.equal(entry.sourceText, 'QA');
  assert.equal(entry.targetText, 'quality');
});

/* ── 수정 ─────────────────────────────────────────────────────────────── */

test('기존 항목을 수정할 수 있다', async () => {
  const entry = await addPersonalGlossaryEntry({ sourceText: 'QA', targetText: 'quality assurance' });
  const updated = await updatePersonalGlossaryEntry(entry.id, { targetText: 'QA team' });

  assert.equal(updated.targetText, 'QA team');
  const list = await listPersonalGlossary();
  assert.equal(list.find((e) => e.id === entry.id).targetText, 'QA team');
});

test('없는 id를 수정하면 null을 돌려주고 아무것도 바뀌지 않는다', async () => {
  const before = await listPersonalGlossary();
  const result = await updatePersonalGlossaryEntry('없는-id', { sourceText: 'x' });
  assert.equal(result, null);
  assert.deepEqual(await listPersonalGlossary(), before);
});

test('keepSource로 전환하면 기존 targetText가 null로 정리된다', async () => {
  const entry = await addPersonalGlossaryEntry({ sourceText: 'QA', targetText: 'quality assurance' });
  const updated = await updatePersonalGlossaryEntry(entry.id, { keepSource: true });
  assert.equal(updated.targetText, null);
  assert.equal(updated.keepSource, true);
});

/* ── 삭제 ─────────────────────────────────────────────────────────────── */

test('삭제하면 목록에서 사라지고 true를 돌려준다', async () => {
  const entry = await addPersonalGlossaryEntry({ sourceText: 'QA', targetText: 'quality assurance' });
  const removed = await removePersonalGlossaryEntry(entry.id);

  assert.equal(removed, true);
  assert.ok(!(await listPersonalGlossary()).some((e) => e.id === entry.id));
});

test('없는 id를 삭제하면 false를 돌려주고 목록은 그대로다', async () => {
  const before = await listPersonalGlossary();
  const removed = await removePersonalGlossaryEntry('없는-id');
  assert.equal(removed, false);
  assert.deepEqual(await listPersonalGlossary(), before);
});

/* ── /v1/refine payload 변환 — prompt.js glossaryRules() 계약과 맞아야 한다 ─ */

test('toRefinePayloadGlossary: entryType/scope를 고정하고 필드를 계약 형태로 맞춘다', () => {
  const [mapped] = toRefinePayloadGlossary([
    { id: 'gl-1', sourceText: '배포', targetText: 'rollout', keepSource: false },
  ]);
  assert.deepEqual(mapped, {
    id: 'gl-1',
    entryType: 'term',
    scope: 'personal',
    sourceText: '배포',
    targetText: 'rollout',
    keepSource: false,
  });
});

test('toRefinePayloadGlossary: keepSource 엔트리는 targetText가 null로 나간다', () => {
  const [mapped] = toRefinePayloadGlossary([
    { id: 'gl-2', sourceText: '사이', targetText: null, keepSource: true },
  ]);
  assert.equal(mapped.targetText, null);
  assert.equal(mapped.keepSource, true);
});

/* ── 영속성 — getLocal로 직접 읽어도 같은 값이어야 한다(저장 경로 확인) ──── */

test('저장은 STORAGE_KEYS.GLOSSARY_PERSONAL 키를 실제로 쓴다', async () => {
  await addPersonalGlossaryEntry({ sourceText: 'QA', targetText: 'quality assurance' });
  const raw = await getLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, null);
  assert.ok(Array.isArray(raw));
  assert.ok(raw.some((e) => e.sourceText === 'QA'));
});
