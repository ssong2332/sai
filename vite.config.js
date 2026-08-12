import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.js';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // Lessons #1 — 콘텐츠 스크립트는 브라우저 페이지에서 실행되므로 Node 전역(process)이
  // 없다. React 등이 참조하는 process.env.NODE_ENV를 빌드 시점 문자열로 치환하지 않으면
  // 모든 페이지에서 즉시 크래시한다(jsdom 테스트로는 잡히지 않는 유형).
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
});
