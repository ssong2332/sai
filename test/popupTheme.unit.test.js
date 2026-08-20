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

test('🔴 테마 적용은 저장소 읽기를 기다리지 않는다 — 고아 컨텍스트에서도 attribute가 붙는다', () => {
  assert.match(boot, /applyTheme\(null\)/, '동기 1차 적용이 없다');
  assert.match(boot, /\.catch\(/, '저장소 읽기 실패 경로가 없다');
});

/**
 * 🔴 **기본 테마는 라이트다** (2026-08-20 사용자 결정). 예전 기본값은 「OS 설정을 따름」이라
 *    OS가 다크인 사람은 **고른 적도 없는데** 다크로 시작했다.
 * 🔴 **두 화면이 같은 기본값을 써야 한다.** 팝업(콘텐츠 스크립트)과 사이드패널이 갈리면 같은
 *    페이지에서 패널은 라이트, 팝업은 다크가 된다 — 이 테스트가 그 어긋남을 잠근다.
 */
test('🔴 저장값이 없을 때 팝업·사이드패널 둘 다 라이트로 시작한다', () => {
  const panel = readFileSync(new URL('../src/sidepanel/App.jsx', import.meta.url), 'utf8');

  assert.match(boot, /data-theme',\s*theme \?\? 'light'/, '팝업 기본값이 라이트가 아니다');
  assert.match(panel, /setTheme\(stored \?\? 'light'\)/, '사이드패널 기본값이 라이트가 아니다');
  // 🔴 OS 선호를 «기본값 결정»에 다시 쓰면 안 된다 — 그게 예전 동작이다.
  assert.doesNotMatch(boot, /prefers-color-scheme/, '팝업이 아직 OS 설정을 본다');
  assert.doesNotMatch(panel, /prefers-color-scheme/, '사이드패널이 아직 OS 설정을 본다');
});
