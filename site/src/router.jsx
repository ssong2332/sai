import { useEffect, useState } from 'react';

/** History API 라우터 — 경로 5개뿐이라 라이브러리를 들이지 않는다. */
export const ROUTES = ['/', '/pricing', '/settings', '/privacy', '/terms'];

function currentLocation() {
  return { path: window.location.pathname.replace(/\/+$/, '') || '/', search: window.location.search };
}

export function navigate(to) {
  const url = new URL(to, window.location.origin);
  if (url.origin !== window.location.origin) {
    window.location.href = to;
    return;
  }
  window.history.pushState({}, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  if (url.hash) {
    requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView());
  } else {
    window.scrollTo(0, 0);
  }
}

export function useLocation() {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onPop = () => setLocation(currentLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return location;
}

/** 같은 사이트 안 링크 — 수정 키(새 탭 등)는 브라우저에 맡긴다. */
export function Link({ to, children, onClick, ...rest }) {
  const handle = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const url = new URL(to, window.location.origin);
    // 같은 페이지 안의 #앵커는 브라우저 기본 동작(스크롤)에 맡긴다.
    if (url.pathname === window.location.pathname && url.hash && url.search === window.location.search) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
