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
  build: {
    rollupOptions: {
      input: {
        /**
         * 🔴 결정 로그 페이지(S25)는 **manifest의 어떤 필드에도 안 실린다** — side_panel이나
         *    action처럼 크롬이 여는 자리가 아니라, 우리가 `chrome.tabs.create`로 여는 일반
         *    확장 페이지다. crxjs는 manifest에 적힌 HTML만 자동으로 물어 가므로 여기서
         *    직접 입력으로 넣어야 빌드된다(안 넣으면 dist에 아예 안 생긴다).
         */
        decisions: 'src/decisions/index.html',
      },
    },
  },
});
