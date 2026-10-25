/**
 * 설정 페이지 하네스 — 실제 `src/settings/App.jsx`를 가짜 `chrome.*`(목업 저장소)로 렌더한다 (2026-10-25).
 * 사용: http://127.0.0.1:5199/settings.html#general (?theme=dark). 패널은 해시(#activation · #integrations · #blocked · #data …).
 * 🔴 `src/settings/main.jsx`와 같은 CSS를 같은 순서로 싣는다.
 * 🔴 화면 검토용이다. 실브라우저 unpacked 확인을 대신하지 않는다.
 */
import './pageStub.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/settings/App.jsx';
import '../../src/styles/fonts.css';
import '../../src/styles/tokens.css';
import '../../src/styles/motion.css';
import '../../src/settings/settings.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
