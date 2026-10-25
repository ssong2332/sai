/**
 * 결정 화면 하네스 — 실제 `src/decisions/App.jsx`를 가짜 `chrome.*`(동의 + 목업 로그 1건)로 렌더한다.
 * 사용: http://127.0.0.1:5199/decisions.html (?theme=dark)
 * 🔴 결정 화면은 테마를 스스로 읽지 않는다(실제 앱 그대로) — 하네스만 `?theme=dark`로 attribute를 붙인다.
 */
import './pageStub.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/decisions/App.jsx';
import '../../src/styles/fonts.css';
import '../../src/styles/tokens.css';
import '../../src/styles/motion.css';
import '../../src/decisions/decisions.css';

if (new URLSearchParams(location.search).get('theme') === 'dark') {
  document.documentElement.dataset.theme = 'dark';
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
