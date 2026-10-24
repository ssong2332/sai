/**
 * 디자인 하네스 (개발 전용 — 확장 번들에 들어가지 않는다).
 *
 * 🔴 확장의 `vite.config.js`(crx 플러그인)와 **별개 앱**이다. 콘텐츠 팝업 컴포넌트를 목업 props와
 *    가짜 `chrome.*`로 렌더해, 확장을 로드하지 않고 화면을 검토·스크린샷한다.
 * 🔴 실브라우저 unpacked 확인을 대신하지 않는다(CLAUDE.md 금지 — Lessons #1).
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  // 🔴 확장의 `public/`(번들 서체 `fonts/`)을 그대로 쓴다 — 확장 페이지와 같은 `/fonts/...` 경로가 열린다.
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
    'process.env.SAI_SITE_DEV': JSON.stringify(''),
  },
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
});
