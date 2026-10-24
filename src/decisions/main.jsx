import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
// 시안 A2 — 번들 서체 `SaiPretendard`(public/fonts, OFL).
import '../styles/fonts.css';
import '../styles/tokens.css';
// v2(2026-10-24) — keyframes가 tokens.css에서 motion.css로 옮겨졌다(`docs/design/DesignSystem-A2.md`).
import '../styles/motion.css';
import './decisions.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
