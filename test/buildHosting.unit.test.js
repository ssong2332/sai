/**
 * 호스팅 조립 — 처리방침·약관의 단일 출처(2026-10-25).
 *
 * 🔴 `site/src/legal/*.html`은 `dashboard/public/*.html`의 `<main>` 본문이어야 한다. 원본만 고치고
 *    `node scripts/build-hosting.mjs`를 안 돌리면 소개 사이트의 /privacy가 옛 문구(Gemini)로 남는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractMain } from '../scripts/build-hosting.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

for (const doc of ['privacy', 'terms']) {
  test(`site/src/legal/${doc}.html이 dashboard/public 원본의 <main> 본문과 같다`, () => {
    const expected = extractMain(read(`dashboard/public/${doc}.html`));
    const copy = read(`site/src/legal/${doc}.html`).replace(/^<!--[^\n]*-->\n/, '');
    assert.equal(copy.trimEnd(), expected.trimEnd());
  });
}

test('extractMain은 <main>이 없으면 멈춘다 — 빈 페이지를 올리지 않는다', () => {
  assert.throws(() => extractMain('<body><p>x</p></body>'));
});

test('extractMain은 앞 들여쓰기를 걷고 본문만 돌려준다', () => {
  assert.equal(extractMain('<main>\n      <h1>T</h1>\n      <p>b</p>\n    </main>'), '<h1>T</h1>\n      <p>b</p>');
});
