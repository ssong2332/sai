#!/usr/bin/env node
/**
 * Firebase Hosting 산출물 조립 — `hosting-dist/` (2026-10-25, 홈페이지를 소개 사이트로).
 *
 * | 주소 | 내용 | 출처 |
 * |---|---|---|
 * | `/` · `/pricing` · `/settings` · `/privacy` · `/terms` · `/refund` | 소개 사이트(SPA) | `site/` 빌드 |
 * | `/dashboard/` | 팀 대시보드(SPA) | `dashboard/` 빌드(`--base=/dashboard/`) |
 * | `/privacy.html` · `/terms.html` · `/refund.html` | 처리방침·약관·환불 정책 원본 | `dashboard/public/` — 구글 브랜딩(L25)이 이 주소를 가리킨다(환불 정책은 2026-10-31, Paddle 도메인 심사) |
 *
 * 🔴 처리방침·약관의 **단일 출처는 `dashboard/public/*.html`**이다. 소개 사이트의 `/privacy`·`/terms`가
 *    쓰는 `site/src/legal/*.html`은 여기서 그 `<main>` 본문을 뽑아 다시 쓴다 — 손으로 고치지 않는다.
 * 🔴 옛 확장(0.1.17 이하)은 팀 대시보드를 `/#sai=…`로 연다. `site/index.html`의 첫 스크립트가
 *    `/dashboard/`로 넘긴다.
 *
 * `firebase.json`의 hosting.predeploy가 이 스크립트를 부른다.
 */

import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'hosting-dist');
const LEGAL_DOCS = ['privacy', 'terms', 'refund'];

/** 원본 HTML의 `<main>` 안쪽만 돌려준다. 못 찾으면 멈춘다(조용히 빈 페이지를 올리지 않는다). */
export function extractMain(html) {
  const match = html.match(/<main>\r?\n([\s\S]*?)\r?\n\s*<\/main>/);
  if (!match) throw new Error('<main> 블록을 찾지 못했다');
  return match[1].replace(/^\s+/, '');
}

async function syncLegal() {
  for (const doc of LEGAL_DOCS) {
    const source = await readFile(join(root, 'dashboard', 'public', `${doc}.html`), 'utf8');
    const header = `<!-- dashboard/public/${doc}.html의 <main> 본문 — scripts/build-hosting.mjs가 만든다. 손으로 고치지 않는다. -->\n`;
    await writeFile(join(root, 'site', 'src', 'legal', `${doc}.html`), header + extractMain(source) + '\n');
  }
}

function run(command) {
  execSync(command, { cwd: root, stdio: 'inherit' });
}

async function main() {
  await syncLegal();
  run('npm --prefix site run build');
  run('npm --prefix dashboard run build -- --base=/dashboard/');

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(join(root, 'site', 'dist'), out, { recursive: true });
  await cp(join(root, 'dashboard', 'dist'), join(out, 'dashboard'), { recursive: true });
  for (const doc of LEGAL_DOCS) {
    await cp(join(root, 'dashboard', 'public', `${doc}.html`), join(out, `${doc}.html`));
  }
  console.log(`hosting-dist 조립 완료 — 소개 사이트 + /dashboard/ + ${LEGAL_DOCS.map((d) => `/${d}.html`).join(' ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
