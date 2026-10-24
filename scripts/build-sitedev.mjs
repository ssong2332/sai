#!/usr/bin/env node
/**
 * 사이트 개발 빌드 — `npm run build:sitedev` (2026-10-24, `docs/WebSplit.md` 「C — 로컬 브리지」).
 *
 * `SAI_SITE_DEV=1`을 켜고 `vite build`를 돌린다. 그러면 `src/config.js`가
 *   - manifest `externally_connectable.matches`에 `http://localhost:5180/*`를 붙이고
 *   - 확장 화면의 `SITE_URL`을 `http://localhost:5180`으로 둔다.
 *
 * 🔴 **왜 `SAI_SITE_DEV=1 vite build`를 package.json에 바로 쓰지 않나** — npm은 Windows에서 cmd로
 *    스크립트를 돌리고, cmd는 `VAR=값 명령` 문법을 모른다. cross-env 같은 의존성을 늘리지 않으려고
 *    Node에서 환경 변수를 세운 뒤 vite의 JS API를 부른다.
 * 🔴 vite는 `build()` 안에서 `vite.config.js`(→ `src/manifest.js` → `src/config.js`)를 **이 프로세스에서**
 *    읽으므로, 아래 한 줄이 manifest와 번들(define) 양쪽에 같이 닿는다.
 * 🔴 **산출물은 기본 빌드와 같은 `dist/`다.** 이 빌드를 스토어·테스터에게 내보내면 안 된다 —
 *    배포본은 반드시 `npm run build`로 다시 만든다.
 */

import { build } from 'vite';

process.env.SAI_SITE_DEV = '1';

await build();
