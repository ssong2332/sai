/**
 * 외부 도구 용어집 붙여넣기 가져오기 (2026-08-16).
 *
 * 🔴 붙여넣기는 **사고가 나기 쉬운 입력**이다(문서를 통째로 복사, 머리글 포함, 값에 쉼표).
 *    이 테스트가 지키는 것: ① 스프레드시트 복사(탭)가 깨지지 않는다 ② 쉼표 든 값이 쪼개지지
 *    않는다 ③ 건너뛴 줄을 **세어서** 화면이 사실대로 말할 수 있다 ④ 상한이 있다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseGlossaryText, MAX_IMPORT_ROWS } from '../src/lib/glossaryImport.js';

test('스프레드시트 복사(탭 구분)를 읽는다', () => {
  const { entries } = parseGlossaryText('배포\trollout\n기획서\tproduct spec');
  assert.deepEqual(entries, [
    { sourceText: '배포', targetText: 'rollout', keepSource: false },
    { sourceText: '기획서', targetText: 'product spec', keepSource: false },
  ]);
});

test('CSV도 읽는다', () => {
  const { entries } = parseGlossaryText('배포,rollout');
  assert.equal(entries[0].targetText, 'rollout');
});

test('🔴 탭이 있으면 탭을 먼저 본다 — 값에 든 쉼표가 칸을 쪼개면 안 된다', () => {
  const { entries } = parseGlossaryText('본사\tSeoul, Korea');
  assert.equal(entries[0].targetText, 'Seoul, Korea');
});

test('따옴표로 감싼 CSV 값을 벗긴다', () => {
  const { entries } = parseGlossaryText('"본사","Seoul"');
  assert.deepEqual(entries[0], { sourceText: '본사', targetText: 'Seoul', keepSource: false });
});

test('🔴 번역어가 비면 「원문 유지」다 — 개인 용어집과 같은 규칙', () => {
  const { entries } = parseGlossaryText('사이');
  assert.deepEqual(entries[0], { sourceText: '사이', targetText: '', keepSource: true });
});

test('머리글 줄은 버린다', () => {
  const { entries } = parseGlossaryText('원문\t번역\n배포\trollout');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceText, '배포');
});

test('빈 줄은 건너뛰되 건너뛴 것으로 세지 않는다', () => {
  const { entries, skipped } = parseGlossaryText('배포\trollout\n\n\n기획서\tspec');
  assert.equal(entries.length, 2);
  assert.equal(skipped, 0);
});

test('🔴 같은 원문이 두 번이면 뒤엣것을 버린다 — 어느 쪽이 이기는지 모호한 항목을 만들지 않는다', () => {
  const { entries, skipped } = parseGlossaryText('배포\trollout\n배포\tdeploy');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].targetText, 'rollout');
  assert.equal(skipped, 1);
});

test('🔴 건너뛴 줄을 센다 — 조용히 버리면 사용자는 다 들어간 줄 안다', () => {
  const { entries, skipped } = parseGlossaryText('\t번역만있음\n배포\trollout');
  assert.equal(entries.length, 1);
  assert.equal(skipped, 1);
});

test('세 칸 이상이면 앞 두 칸만 쓴다', () => {
  const { entries } = parseGlossaryText('배포\trollout\t메모\t더');
  assert.deepEqual(entries[0], { sourceText: '배포', targetText: 'rollout', keepSource: false });
});

test('🔴 상한이 있다 — 문서를 통째로 붙여넣는 사고를 막는다', () => {
  const many = Array.from({ length: MAX_IMPORT_ROWS + 50 }, (_, i) => `용어${i}\tterm${i}`).join('\n');
  const { entries, truncated } = parseGlossaryText(many);
  assert.equal(entries.length, MAX_IMPORT_ROWS);
  assert.equal(truncated, true, '잘렸다는 사실을 화면이 말할 수 있어야 한다');
});

test('긴 값은 잘린다 — 본문이 용어를 가장해 들어오지 못하게', () => {
  const { entries } = parseGlossaryText(`${'가'.repeat(500)}\tx`);
  assert.equal(entries[0].sourceText.length, 200);
});

test('빈 입력은 빈 결과다 — 던지지 않는다', () => {
  assert.deepEqual(parseGlossaryText(''), { entries: [], skipped: 0, truncated: false });
  assert.deepEqual(parseGlossaryText(null), { entries: [], skipped: 0, truncated: false });
});

test('🔴 노션 표 복사(머리글 + 메모 열)를 그대로 읽는다 — docs/NotionGlossaryTemplate.md 계약', () => {
  // 노션 표를 복사하면 탭 구분(TSV)으로 붙는다. 메모 열이 있어도 앞 두 칸만 쓴다.
  const pasted = [
    ['원문', '번역어', '메모'].join('\t'),
    ['배포', 'rollout', 'deployment 아님'].join('\t'),
    ['사이', '', '제품명'].join('\t'),
  ].join('\n');
  const { entries, skipped } = parseGlossaryText(pasted);
  assert.deepEqual(entries, [
    { sourceText: '배포', targetText: 'rollout', keepSource: false },
    { sourceText: '사이', targetText: '', keepSource: true },
  ]);
  assert.equal(skipped, 0);
});
