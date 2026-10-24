import { useCallback, useEffect, useState } from 'react';

const KEY = 'sai-site-theme';

/** 이 웹페이지의 테마. 확장의 테마(설정 › 일반)와는 따로다. 저장은 이 브라우저에만. */
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

export function useSiteTheme() {
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
