/**
 * Shadow DOM 색 상속 (2026-08-20 — 「검은 글씨」 세 번 지적된 뒤 잡은 원인).
 *
 * 🔴 **원인**: 부트스트랩이 호스트에 **인라인**으로 `all:initial`을 준다(호스트 페이지 스타일
 *    차단). 인라인은 어떤 선택자보다 세므로 `:host { color: var(--ink) }`가 지고, 호스트의
 *    계산된 색이 `initial`(검정)이 되어 shadow 트리로 상속됐다. 그래서 **자기 색을 선언하지
 *    않은 요소만** 라이트·다크 상관없이 검게 나왔다.
 * 🔴 그래서 **뿌리 컨테이너가 색을 다시 세운다** — 요소마다 붙이는 방식은 빠뜨린 하나가 또
 *    검은 글씨로 남는다(실제로 `.sai-vent-title` 하나가 그렇게 남아 있었다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/content/content.css', import.meta.url), 'utf8');
const boot = readFileSync(new URL('../src/content/index.jsx', import.meta.url), 'utf8');

test('🔴 호스트 인라인 `all:initial`은 그대로다 — 격리가 목적이라 지우면 안 된다', () => {
  assert.match(boot, /all:initial/, '호스트 격리가 사라졌다');
});

test('🔴 shadow 트리의 뿌리 컨테이너가 글자색을 다시 세운다', () => {
  const roots = ['.sai-popup', '.sai-toast', '.sai-fab-wrap', '.sai-fab-snippets'];
  const block = css.match(/([^{}]*)\{\s*color:\s*var\(--ink\);\s*\}/g) ?? [];
  const joined = block.join('\n');
  for (const sel of roots) {
    assert.ok(joined.includes(sel), `${sel}이 색을 세우지 않는다 — 상속으로 검정이 내려온다`);
  }
});

test('🔴 테마 적용은 저장소 읽기를 기다리지 않는다 — 읽기가 실패해도 라이트로 굳지 않게', () => {
  assert.match(boot, /applyTheme\(null\)/, '동기 1차 적용이 없다');
  assert.match(boot, /\.catch\(/, '저장소 읽기 실패 경로가 없다');
});
