/**
 * 회신 방향 칩 — 선택한 칩 위에 마우스가 있어도 이름이 보여야 한다 (2026-11-10 실측 결함).
 * 🔴 예전 `.sai-reply-intent:hover:not(:disabled)`가 선택 칩 글자를 `--ink`로 바꿔 잉크 배경에 잉크 글자가 됐다
 *    (라이트 rgb(25,31,40) on rgb(25,31,40) · 다크도 같음, 사용자 스크린샷). 색 실측은 실제 CSS를 크로미움에 띄워 했고,
 *    이 테스트는 그 두 규칙의 모양만 잠근다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/content/content.css', import.meta.url), 'utf8');

test('🔴 마우스 올림 규칙은 선택된 칩을 제외한다 — 잉크 배경에 잉크 글자 방지', () => {
  const hoverSelectors = css.match(/\.sai-reply-intent:hover[^{]*\{/g) ?? [];
  assert.ok(hoverSelectors.length > 0, '마우스 올림 규칙이 없다');
  for (const selector of hoverSelectors) {
    assert.match(selector, /:not\(\.sai-reply-intent-on\)/, selector);
  }
});

test('선택한 칩은 초안을 만드는 동안(disabled)에도 흰 글자(--on-ink)를 유지한다', () => {
  assert.match(css, /\.sai-reply-intent-on:disabled\s*\{\s*color:\s*var\(--on-ink\);/);
});
