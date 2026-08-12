// 툴바 아이콘 클릭 → 사이드 패널 열기 (Spec §1 UI 삼원화 — Side Panel 진입점)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[사이] sidePanel 설정 실패:', error));
