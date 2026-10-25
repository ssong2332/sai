import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
// 시안 A2 — 번들 서체 `SaiPretendard`(public/fonts, OFL) · 토큰 · 모션. 결정 화면(`src/decisions/main.jsx`)과 같은 순서.
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/motion.css';
import './settings.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
