import { useState } from 'react';

// Spec §1 — 사이드 패널 탭 구성. S01은 셸만 세우고 각 탭 내용은 담당 태스크가 채운다:
// 온보딩 S11 · 용어집 S12 · 프로필/학습내역 S13 · 스니펫 S20 · B2B 데모 배너 S18.
const TABS = [
  { id: 'onboarding', label: '온보딩' },
  { id: 'glossary', label: '용어집' },
  { id: 'profile', label: '프로필' },
  { id: 'snippets', label: '스니펫' },
  { id: 'learned', label: '학습내역' },
  { id: 'b2b', label: 'B2B 데모' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('onboarding');

  return (
    <div className="panel">
      <header className="panel-header">
        <h1 className="panel-title">사이</h1>
        <p className="panel-subtitle">언어와 언어 사이를 매끄럽게</p>
      </header>
      <nav className="panel-tabs" aria-label="사이 메뉴">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'tab tab-active' : 'tab'}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="panel-body">
        <p className="placeholder">
          {TABS.find((tab) => tab.id === activeTab)?.label} 화면은 준비 중입니다.
        </p>
      </main>
    </div>
  );
}
