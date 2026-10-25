import { useState } from 'react';
import { Link } from '../router.jsx';
import { useScrollFrame } from '../motion.js';
import SaiMark from './SaiMark.jsx';

function ThemeIcon({ theme }) {
  // 지금 테마가 아니라 「누르면 바뀔 테마」를 보여 준다.
  return theme === 'dark' ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

const SECTIONS = [
  { id: 'write', label: '쓸 때' },
  { id: 'read', label: '받을 때' },
  { id: 'send', label: '보낼 때' },
  { id: 'keep', label: '데이터' },
];

/** 고정 반투명 내비(시안 A2). 스크롤 20px부터 유리 배경 — rAF로 묶어 읽는다. */
export function Header({ theme, onToggleTheme, landing = false }) {
  const [solid, setSolid] = useState(false);
  const [dark, setDark] = useState(false);
  useScrollFrame(() => {
    const next = window.scrollY > 20;
    setSolid((prev) => (prev === next ? prev : next));
    // 「보낼 때」 밤 장면 위를 지날 때는 내비도 밤색 유리로 바뀐다
    const night = landing ? document.getElementById('send') : null;
    let over = false;
    if (night) {
      const r = night.getBoundingClientRect();
      over = r.top <= 32 && r.bottom >= 32;
    }
    setDark((prev) => (prev === over ? prev : over));
  });

  return (
    <header className={`nav${solid || !landing ? ' solid' : ''}${dark ? ' dark' : ''}`}>
      <div className="wrap">
        <Link to="/" className="brand" aria-label="사이 홈">
          <SaiMark size={30} live={landing} title="" />
          <span aria-hidden="true">사이</span>
        </Link>
        <span className="sp" />
        <nav aria-label="주요 메뉴" style={{ display: 'contents' }}>
          {SECTIONS.map((s) => (
            <Link key={s.id} to={landing ? `#${s.id}` : `/#${s.id}`} className="nav-link">
              {s.label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          className="theme-t press"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기'}
        >
          <ThemeIcon theme={theme} />
        </button>
        <Link to="/settings" className="btn sm primary press">
          설정
        </Link>
      </div>
    </header>
  );
}

export function Footer({ landing = false }) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <Link to="/" className="brand" aria-label="사이 홈">
          <SaiMark size={26} title="" />
          <span aria-hidden="true">사이</span>
        </Link>
        <span className="sp" />
        <nav aria-label="문서">
          <Link to="/privacy">개인정보처리방침</Link>
          <Link to="/terms">이용약관</Link>
          <Link to="/settings">설정</Link>
        </nav>
        <p className="footer-note">메시지 본문은 사이 서버와 데이터베이스에 저장하지 않습니다.
          {landing && ' 이 페이지의 예시 문장과 시각은 미리 써 둔 것이에요.'}
        </p>
      </div>
    </footer>
  );
}
