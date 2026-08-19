/**
 * 콘텐츠 스크립트 부트스트랩 — 모든 페이지에서 실행되는 가장 위험한 지점이다.
 *
 * 🔴 Shadow DOM에 붙인다 (Lessons #3): 실페이지 CSS는 적대적이다. 호스트 페이지 스타일이
 *    팝업을 부수는 것도, 우리 스타일이 호스트 페이지로 새는 것도 둘 다 막아야 한다.
 * 🔴 CSS는 `?inline`으로 **문자열**로 받아 shadow root 안에 넣는다. 그냥 `import './x.css'`
 *    하면 crxjs가 호스트 페이지 <head>에 주입해 격리가 깨진다.
 * 🔴 Lessons #1: `process.env`류 Node 전역을 건드리면 전 페이지가 즉사한다 —
 *    `vite.config.js`의 define 처리가 이 파일을 지킨다.
 */

import { createRoot } from 'react-dom/client';
import tokensCss from '../styles/tokens.css?inline';
import contentCss from './content.css?inline';
import SaiOverlay from './SaiOverlay.jsx';
import { getLocal, STORAGE_KEYS } from '../lib/storage.js';

const HOST_ID = 'sai-root';

function mount() {
  if (document.getElementById(HOST_ID)) return; // 중복 주입 방지 (SPA 재진입 등)

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.dataset.saiRoot = '';
  // 호스트 요소 자체는 레이아웃에 영향을 주지 않는다 — 내부는 전부 position:fixed다.
  host.style.cssText = 'all:initial;position:static';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${contentCss}`;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  // 사이드패널에서 고른 테마를 팝업에도 적용한다 (2026-08-12 결정으로 다크모드 v1 포함).
  const applyTheme = (theme) => {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    host.setAttribute('data-theme', theme ?? (prefersDark ? 'dark' : 'light'));
  };
  /**
   * 🔴 **저장 읽기를 기다리지 않고 먼저 한 번 적용한다** (2026-08-19 실사용 결함 — 다크
   *    페이지 위에 라이트 팝업이 떠서 「검은 글씨」로 보고됨).
   *
   *    예전에는 attribute가 `getLocal` **이후에야** 붙었고, 그 호출에 **catch가 없었다.**
   *    확장을 리로드하면(unpacked 개발 중 수시로 일어난다) 이미 열려 있던 탭의 콘텐츠
   *    스크립트는 고아가 되어 `chrome.storage` 호출이 "Extension context invalidated"로
   *    던진다 — 그러면 `applyTheme`이 영영 안 불려 **attribute 없음 = 라이트 토큰**으로
   *    남는다. 오버레이 자체는 이미 마운트돼 있어 겉보기엔 멀쩡히 동작하므로, 테마만
   *    조용히 틀린 채 유지된다.
   * 🔴 동기 1차 적용(OS 기준) → 저장값이 오면 덮어쓴다. 실패해도 OS 기준이 남는다.
   */
  applyTheme(null);
  getLocal(STORAGE_KEYS.THEME, null)
    .then(applyTheme)
    .catch(() => {
      /* 고아 컨텍스트 — 위의 OS 기준 적용이 그대로 유효하다. */
    });

  // 🔴 저장값이 없어 OS를 따르는 동안, OS 테마가 바뀌면 즉시 따라간다.
  //    (저장값이 있으면 아래 storage 리스너가 이기므로 이 리스너는 겹치지 않는다.)
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', async () => {
    try {
      const stored = await getLocal(STORAGE_KEYS.THEME, null);
      if (stored === null) applyTheme(null);
    } catch {
      applyTheme(null);
    }
  });

  /**
   * 🔴 마운트 때 한 번만 읽으면 **사이드패널에서 테마를 바꿔도 팝업은 그대로**다
   *    (2026-08-13 사용자 지적). 저장소 변경을 구독해 즉시 따라간다.
   */
  if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEYS.THEME]) {
        applyTheme(changes[STORAGE_KEYS.THEME].newValue);
      }
    });
  }

  createRoot(mountPoint).render(<SaiOverlay />);
}

// document_idle에 실행되지만 방어적으로 한 번 더 확인한다.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}

console.info('[사이] content script 로드됨:', location.hostname);
