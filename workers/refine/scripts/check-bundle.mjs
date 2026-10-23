/**
 * 번들 검사 — `npm run build:dry`가 만든 `.wrangler/dry/index.js`에 **Anthropic SDK가 없는지**·크기를 본다 (2026-10-23 L33).
 *
 * 🔴 왜: SDK가 번들에 있던 때 배포본 cold cpuTime 34ms·30ms(무료 한도 10ms). `wrangler.toml` `[alias]`가 SDK를
 *    `src/anthropicFetch.js`로 바꿔 끼운다 — 그 줄이 지워지거나 다른 경로로 SDK가 다시 들어오면 여기서 실패한다.
 * 판정표
 * | 조건 | 결과 |
 * |---|---|
 * | 번들 파일 없음 | exit 2 (먼저 `npm run build:dry`) |
 * | 원문에 `node_modules/@anthropic-ai/` 경로 주석 | exit 1 — SDK가 번들됐다 |
 * | 대역 `src/anthropicFetch.js` 주석 없음 | exit 1 — alias가 안 걸렸다 |
 * | 크기 > 300 KiB | exit 1 — 🔴 기준선 112.8 KiB(2026-10-23). 무거운 의존성이 새로 들어왔다는 신호 |
 * | 그 밖 | exit 0 + 크기·의존성별 원문 크기 출력 |
 *
 * 실행: `npm run check:bundle` (workers/refine 안에서 — build:dry를 먼저 돌린다)
 */

import { existsSync, readFileSync, statSync } from 'node:fs';

const BUNDLE = new URL('../.wrangler/dry/index.js', import.meta.url);
const MAP = new URL('../.wrangler/dry/index.js.map', import.meta.url);
const LIMIT_KIB = 300;

if (!existsSync(BUNDLE)) {
  console.error('번들이 없습니다 — 먼저 npm run build:dry');
  process.exit(2);
}

const code = readFileSync(BUNDLE, 'utf8');
const sizeKiB = statSync(BUNDLE).size / 1024;
const failures = [];
if (code.includes('node_modules/@anthropic-ai/')) failures.push('Anthropic SDK가 번들에 있다 — wrangler.toml [alias] 확인');
if (!code.includes('// src/anthropicFetch.js')) failures.push('SDK 대역(src/anthropicFetch.js)이 번들에 없다 — alias가 안 걸렸다');
if (sizeKiB > LIMIT_KIB) failures.push(`번들 ${sizeKiB.toFixed(1)} KiB > ${LIMIT_KIB} KiB`);

console.log(`번들 ${sizeKiB.toFixed(1)} KiB (${BUNDLE.pathname.split('/').slice(-3).join('/')})`);
if (existsSync(MAP)) {
  // 소스맵의 원문 크기(압축 전 소스 — 번들 크기와 단위가 다르다, 비중만 본다).
  const map = JSON.parse(readFileSync(MAP, 'utf8'));
  const byGroup = {};
  map.sources.forEach((source, i) => {
    const nm = source.lastIndexOf('node_modules/');
    let group;
    if (nm >= 0) {
      const rest = source.slice(nm + 'node_modules/'.length).split('/');
      group = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    } else {
      group = source.replace(/^(\.\.\/)+/, '').split('/').slice(0, 3).join('/');
    }
    byGroup[group] = (byGroup[group] ?? 0) + (map.sourcesContent?.[i]?.length ?? 0);
  });
  for (const [group, size] of Object.entries(byGroup).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${(size / 1024).toFixed(1).padStart(7)} KiB  ${group}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`실패: ${failure}`);
  process.exit(1);
}
console.log('통과 — SDK 없음, 대역 있음');
