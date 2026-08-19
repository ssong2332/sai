#!/usr/bin/env node
/**
 * `src/core/{refine,decode,decisions}/` → `functions/core/…` 복사.
 *
 * 🔴 왜 필요한가: `firebase deploy`는 **`functions/` 디렉터리만 업로드한다.** 그래서
 *    `functions/index.js`가 `../src/core/...`를 import하면 로컬에선 되고 배포하면 깨진다
 *    (모듈을 못 찾는다). 조용히 터지는 유형이라 빌드 단계에서 아예 복사해 둔다.
 *
 * 🔴 코어의 **단일 출처는 `src/core/`**다. `functions/core/`는 생성물이므로 직접 고치지
 *    않는다(고쳐도 다음 배포 때 덮어써진다). `functions/.gitignore`가 커밋도 막는다.
 *
 * `firebase.json`의 functions.predeploy가 이 스크립트를 부른다.
 */

import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const coreRoot = join(root, 'src', 'core');
const targetRoot = join(root, 'functions', 'core');

/** 🔴 새 코어 모듈을 추가하면 여기 이름만 더한다. */
const MODULES = ['refine', 'decode', 'decisions', 'reply'];

await rm(targetRoot, { recursive: true, force: true });

for (const name of MODULES) {
  const source = join(coreRoot, name);
  if (!existsSync(source)) {
    console.error(`[sync-core] 원본이 없습니다: ${source}`);
    process.exit(1);
  }
  const target = join(targetRoot, name);
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
}

console.log(`[sync-core] src/core/{${MODULES.join(',')}} → functions/core/ 복사 완료`);
