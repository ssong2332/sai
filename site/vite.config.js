import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 🔴 outDir은 확장의 `dist/`와 겹치지 않는다(Lessons #11) — 이 앱은 확장과 분리된 별도 웹페이지다.
 * 🔴 개발 서버 포트는 5180 고정(strictPort). 확장의 externally_connectable 개발용 매치가 이 포트를
 *    가리키므로, 포트가 조용히 바뀌면 브리지가 「연결 안 됨」으로만 보인다.
 */
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: { port: 5180, strictPort: true },
  build: { outDir: 'dist' },
});
