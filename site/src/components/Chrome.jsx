import { useEffect, useState } from 'react';
import { Link } from '../router.jsx';
import SaiMark from './SaiMark.jsx';

function ThemeIcon({ theme }) {
  // 지금 테마가 아니라 「누르면 바뀔 테마」를 보여 준다.
  return theme === 'dark' ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

export function Header({ theme, onToggleTheme, assemble = false, landing = false }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="site-header" data-scrolled={scrolled}>
      <div className="container site-header-inner">
        <Link to="/" className="brand" aria-label="사이 홈">
          <SaiMark size={34} assemble={assemble} title="" />
          <span aria-hidden="true">사이</span>
        </Link>
        <nav className="site-nav" aria-label="주요 메뉴">
          <Link to={landing ? '#write' : '/#write'} className="nav-link">
            기능
          </Link>
          <Link to={landing ? '#data' : '/#data'} className="nav-link">
            데이터
          </Link>
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기'}
          >
            <ThemeIcon theme={theme} />
          </button>
          <Link to="/settings" className="btn btn-small">
            설정
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <Link to="/" className="brand" aria-label="사이 홈">
          <SaiMark size={30} title="" />
          <span aria-hidden="true">사이</span>
        </Link>
        <nav aria-label="문서">
          <Link to="/privacy">개인정보처리방침</Link>
          <Link to="/terms">이용약관</Link>
          <Link to="/settings">설정</Link>
        </nav>
        <p className="footer-note mono">메시지 본문은 사이 서버와 데이터베이스에 저장하지 않습니다.</p>
      </div>
    </footer>
  );
}
