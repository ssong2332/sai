import { useCallback, useEffect, useState } from 'react';

/**
 * 대시보드 테마 — 소개 사이트(`site/src/theme.js`)와 같은 방식.
 * 저장값이 없으면 시스템 설정을 따르고(`data-theme` 없음 → tokens.css의 미디어 쿼리), 토글하면
 * `data-theme`로 고정한다. 🔴 키는 예전 그대로(`sai-dashboard-theme`) — 이미 고른 테마를 잃지 않는다.
 * 첫 페인트 전 적용은 `index.html`의 인라인 스크립트가 한다(깜빡임 방지).
 */
const KEY = 'sai-dashboard-theme';

function readStored() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [stored, setStored] = useState(readStored);
  const [system, setSystem] = useState(systemTheme);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const onChange = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (stored) document.documentElement.setAttribute('data-theme', stored);
    else document.documentElement.removeAttribute('data-theme');
  }, [stored]);

  const theme = stored ?? system;
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* 저장이 막혀도 이번 화면에는 적용된다 */
    }
    setStored(next);
  }, [theme]);

  return { theme, toggle };
}
