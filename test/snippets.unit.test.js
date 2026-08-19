/**
 * S20 — 스니펫 저장소 단위 테스트 (Spec 권장 10 F-16).
 *
 * 🔴 이 테스트가 지키는 것은 **Zero Retention 단서 3조건**이다(`docs/ZeroRetention.md`):
 *    ① 사용자의 명시적 행동으로만 저장 ② 로컬에만 저장 ③ 개별 삭제 가능.
 *    스니펫은 교정문이 영속되는 **유일한 경로**라, 이 조건이 깨지면 곧바로 필수 5 위반이 된다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  listSnippets,
  addSnippet,
  markSnippetUsed,
  removeSnippet,
  clearSnippets,
  MAX_SNIPPETS,
} from '../src/lib/snippets.js';

test('저장하면 목록에 최신순으로 쌓인다', async () => {
  await clearSnippets();
  await addSnippet({ text: '첫 번째 문장' });
  await addSnippet({ text: '두 번째 문장' });

  const list = await listSnippets();
  assert.equal(list.length, 2);
  assert.equal(list[0].text, '두 번째 문장', '최신이 맨 위여야 한다');
});

test('빈 문장은 저장하지 않는다', async () => {
  await clearSnippets();
  const outcome = await addSnippet({ text: '   ' });
  assert.equal(outcome.ok, false);
  assert.equal((await listSnippets()).length, 0);
});

test('같은 문장을 또 저장하면 중복을 만들지 않고 맨 위로 올린다', async () => {
  await clearSnippets();
  await addSnippet({ text: 'A' });
  await addSnippet({ text: 'B' });
  const outcome = await addSnippet({ text: 'A' });

  assert.equal(outcome.reason, 'duplicate');
  const list = await listSnippets();
  assert.equal(list.length, 2, '중복 항목이 생기면 안 된다');
  assert.equal(list[0].text, 'A');
});

test('상한을 넘으면 저장하지 않고 이유를 알린다 — 조용히 버리지 않는다', async () => {
  await clearSnippets();
  for (let i = 0; i < MAX_SNIPPETS; i += 1) {
    await addSnippet({ text: `문장 ${i}` });
  }
  const outcome = await addSnippet({ text: '넘치는 문장' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'full');
  assert.equal((await listSnippets()).length, MAX_SNIPPETS);
});

test('사용 횟수는 수치로만 누적된다', async () => {
  await clearSnippets();
  const { entry } = await addSnippet({ text: '재사용할 문장' });
  assert.equal(entry.useCount, 0);

  await markSnippetUsed(entry.id);
  await markSnippetUsed(entry.id);

  const [stored] = await listSnippets();
  assert.equal(stored.useCount, 2);
  assert.equal(typeof stored.useCount, 'number');
});

test('🔴 개별 삭제가 동작한다 — Zero Retention 단서 ③의 조건이다', async () => {
  await clearSnippets();
  const { entry } = await addSnippet({ text: '지울 문장' });
  await addSnippet({ text: '남길 문장' });

  assert.equal(await removeSnippet(entry.id), true);
  const list = await listSnippets();
  assert.equal(list.length, 1);
  assert.equal(list[0].text, '남길 문장');
});

test('없는 id를 지우면 false를 돌려준다', async () => {
  await clearSnippets();
  assert.equal(await removeSnippet('sn-nope'), false);
});

/* ── 🔴 소스 수준 가드 — 로컬 밖으로 나가는 경로가 생기면 실패한다 ────── */

/**
 * 🔴 **주석을 걷어내고 검사한다.** 처음엔 원문 그대로 훑었다가, 이 파일들이 바로 그 금지 사항을
 *    주석으로 적어둔 탓에 자기 경고문에 걸려 실패했다(2026-08-13). 우리가 막으려는 것은 실행되는
 *    코드이지 금지를 설명하는 산문이 아니다.
 *    (한계: 문자열 리터럴 안의 `//`까지 구분하지는 않는다 — 이 두 파일에는 해당 사례가 없다.)
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

test('🔴 스니펫 모듈에 서버 전송·sync 저장 코드가 없다 (Zero Retention 단서 ②)', () => {
  const code = stripComments(
    readFileSync(new URL('../src/lib/snippets.js', import.meta.url), 'utf8'),
  );
  const banned = ['fetch(', 'XMLHttpRequest', 'firestore', 'storage.sync'];
  for (const needle of banned) {
    assert.ok(
      !code.includes(needle),
      `스니펫이 기기 밖으로 나가는 경로가 생겼다: "${needle}" — 필수 5 위반이다`,
    );
  }
});

test('🔴 저장 경로가 chrome.storage.local 하나뿐이다', () => {
  const code = stripComments(
    readFileSync(new URL('../src/lib/storage.js', import.meta.url), 'utf8'),
  );
  assert.ok(code.includes('chrome.storage.local'), 'local 저장소를 쓰는지 확인');
  assert.ok(!code.includes('chrome.storage.sync'), 'sync는 구글 계정을 통해 기기 밖으로 나간다');
});
