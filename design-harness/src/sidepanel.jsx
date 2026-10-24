/**
 * 사이드패널 하네스 — 실제 `src/sidepanel/App.jsx`를 가짜 `chrome.*`(목업 저장소)로 렌더한다.
 * 사용: http://127.0.0.1:5199/sidepanel.html (?theme=dark · ?onboarding=new). 폭은 창 크기로 맞춘다(약 400px).
 * 🔴 `src/sidepanel/main.jsx`와 같은 CSS를 같은 순서로 싣는다 — 하네스만 다른 스타일을 보면 검토가 거짓말을 한다.
 * 🔴 화면 검토용이다. 실브라우저 unpacked 확인을 대신하지 않는다.
 */
import './pageStub.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/sidepanel/App.jsx';
import '../../src/styles/fonts.css';
import '../../src/styles/tokens.css';
import '../../src/styles/motion.css';
import '../../src/sidepanel/sidepanel.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
