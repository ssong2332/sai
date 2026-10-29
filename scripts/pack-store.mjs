#!/usr/bin/env node
/**
 * 크롬 웹 스토어 업로드용 zip — `sai-extension-<버전>.zip` (저장소 루트, `.gitignore`가 뺀다) (2026-10-29 L21).
 *
 * | 단계 | 하는 일 | 이유 |
 * |---|---|---|
 * | 1 | `npm run build`로 `dist/`를 새로 만든다 | 개발 빌드(`build:sitedev`)가 남아 있으면 localhost가 섞인다 |
 * | 2 | `dist/`를 임시 폴더에 복사하고 manifest의 `key`를 지운다 | 스토어는 `key`가 든 zip을 거절한다(「key 입력란은 매니페스트에 허용되지 않습니다」 실측) |
 * | 3 | localhost가 manifest에 남았으면 멈춘다 | 공개 빌드에 개발 주소가 나가면 안 된다 |
 * | 4 | 임시 폴더 내용을 zip으로 묶는다(manifest.json이 zip 맨 위) | 스토어 규격 |
 *
 * 🔴 `dist/` 자체는 건드리지 않는다 — unpacked로 불러오는 확장은 `key`가 있어야 스토어와 같은 ID가 된다.
 * 🔴 zip은 Windows 내장 `tar`(bsdtar)로 묶는다. PowerShell `Compress-Archive`는 경로를 `\`로 써서 쓰지 않는다.
 */

import { cp, rm, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');

execSync('npm run build', { cwd: root, stdio: 'inherit' });

const work = await mkdtemp(join(tmpdir(), 'sai-store-'));
try {
  await cp(dist, work, { recursive: true });
  const manifestPath = join(work, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete manifest.key;
  const text = JSON.stringify(manifest, null, 2);
  if (/localhost|127\.0\.0\.1/.test(text)) {
    throw new Error('manifest에 localhost가 남아 있다 — 개발 빌드다. npm run build 결과를 확인한다.');
  }
  await writeFile(manifestPath, text);

  const out = join(root, `sai-extension-${manifest.version}.zip`);
  await rm(out, { force: true });
  const tar = process.platform === 'win32' ? `"${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')}"` : 'tar';
  execSync(`${tar} -a -cf "${out}" *`, { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' });
  console.log(`스토어 업로드용: ${out} (key 없음, 버전 ${manifest.version})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
