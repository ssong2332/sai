import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '사이 (Sai)',
  version: '0.1.0',
  description: '사람과 사람, 언어와 언어 사이를 매끄럽게 잇는 글로벌 업무 메시지 AI 교정 도구',
  action: {
    default_title: '사이 — 사이드 패널 열기',
  },
  background: {
    service_worker: 'src/background/index.js',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.jsx'],
      run_at: 'document_idle',
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  permissions: ['sidePanel', 'storage', 'activeTab', 'clipboardWrite'],
});
