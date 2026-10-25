import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * 🔴 이 outDir은 확장의 `dist/`와 절대 겹치지 않는다 — 검증용 dev 서버가 확장 dist를
 *    덮어쓴 사고(Lessons #11) 재발 방지. 이 앱은 확장과 완전히 분리된 별도 웹페이지다.
 * 🔴 2026-10-25 (0.1.21) — 화면 코드(`src/dashboard/seam/`)는 확장과 한 벌이라 저장소 루트의 소스를 읽는다.
 *    빌드는 상대 경로 import를 그대로 묶고, dev 서버만 루트 밖 파일 접근을 허용해 줘야 한다(`server.fs.allow`).
 *    산출물은 여전히 `dashboard/dist`뿐이다.
 */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
});
