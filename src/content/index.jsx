// 층 구조상 가장 위험한 지점(모든 페이지에서 실행)이므로 S01에서는 최소 동작만 둔다.
// 드래그 선택 → 플로팅 버튼 → 교정 팝업(작성/수신 모드)은 S05/S10에서 이 파일 위에 얹는다.
console.info('[사이] content script 로드됨:', location.hostname);

// S01 스모크 목적: Selection API가 이 페이지에서 실제로 동작하는지 확인할 수 있는 최소 훅.
document.addEventListener('mouseup', () => {
  const text = window.getSelection()?.toString().trim();
  if (text) {
    console.debug('[사이] 선택 감지 (%d자)', text.length);
  }
});
