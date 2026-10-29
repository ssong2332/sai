import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/landing.css';
import './styles/settings.css';
import './styles/legal.css';
import './styles/pricing.css';
import { Link, useLocation } from './router.jsx';
import { useSiteTheme } from './theme.js';
import { Footer, Header } from './components/Chrome.jsx';
import Landing from './pages/Landing.jsx';
import Settings from './pages/Settings.jsx';
import Legal from './pages/Legal.jsx';
import Pricing from './pages/Pricing.jsx';

function NotFound() {
  return (
    <main id="main" className="legal page-pad">
      <div className="wrap legal-inner">
        <h1 className="legal-title">없는 페이지예요</h1>
        <p className="legal-lede">
          주소를 확인하거나 <Link to="/">처음 화면</Link>으로 가세요.
        </p>
      </div>
    </main>
  );
}

function App() {
  const { path, search } = useLocation();
  const { theme, toggle } = useSiteTheme();
  const landing = path === '/';

  // 다른 페이지에서 /#write 로 왔을 때 해당 섹션으로
  useEffect(() => {
    if (landing && window.location.hash) {
      requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView());
    }
  }, [landing]);

  let page;
  if (landing) page = <Landing />;
  else if (path === '/pricing') page = <Pricing />;
  else if (path === '/settings') page = <Settings search={search} />;
  else if (path === '/privacy') page = <Legal doc="privacy" />;
  else if (path === '/terms') page = <Legal doc="terms" />;
  else page = <NotFound />;

  return (
    <>
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <Header theme={theme} onToggleTheme={toggle} landing={landing} />
      {page}
      <Footer landing={landing} />
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
