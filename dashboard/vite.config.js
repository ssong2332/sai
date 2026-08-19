import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 🔴 이 outDir은 확장의 `dist/`와 절대 겹치지 않는다 — 검증용 dev 서버가 확장 dist를
 *    덮어쓴 사고(Lessons #11) 재발 방지. 이 앱은 확장과 완전히 분리된 별도 웹페이지다.
 */
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: 'dist',
  },
});
