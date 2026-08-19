/**
 * 선택 툴바 아이콘 (S25 후속 / 2026-08-14).
 *
 * 🔴 출처: claude.ai/design 「Sai Toolbar Icons」(`assets/icon-*.svg`). 좌표를 그대로 옮겼다 —
 *    임의로 다시 그리지 않는다. 바꿔야 하면 디자인 파일을 먼저 고치고 여기로 옮긴다.
 *
 * 공통 규격(디자인 파일 「공통 규격」 절):
 *   24×24 viewBox · 스트로크 1.8 (16px에서만 2.0) · 라운드 캡·조인 · `currentColor` 상속
 *   버튼 히트 영역 34×34, 아이콘 21px
 *
 * 🔴 `currentColor`를 쓰므로 **다크 모드가 자동으로 따라온다** — 색을 이 파일에 박지 않는다.
 *    채움 변형의 안쪽 표시만 `--surface`를 쓴다(흰색 고정이면 다크에서 떠 보인다).
 */

/** 저장 문구 — 북마크 + 문장 두 줄. 발신 계열이라 주황을 쓴다(색은 호출부가 정한다). */
export function SnippetIcon({ size = 21, filled = false }) {
  if (filled) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6.4 3.9h11.2a1.5 1.5 0 0 1 1.5 1.5v14.3a1 1 0 0 1-1.53.85L12 16.75l-5.57 3.8A1 1 0 0 1 4.9 19.7V5.4a1.5 1.5 0 0 1 1.5-1.5Z"
          fill="currentColor"
        />
        <path
          d="M8.9 8.2h6.2M8.9 11.3h3.6"
          stroke="var(--surface)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 16 ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.4 3.9h11.2a1.5 1.5 0 0 1 1.5 1.5v14.3a1 1 0 0 1-1.53.85L12 16.75l-5.57 3.8A1 1 0 0 1 4.9 19.7V5.4a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M8.9 8.2h6.2M8.9 11.3h3.6" />
    </svg>
  );
}

/**
 * 결정 요약 — 대화 줄 + 체크. 읽기/정리 계열이라 초록을 쓴다.
 * 🔴 **채움 변형은 두지 않았다**(2026-08-14 사용자 결정): 선택 구간이 매번 달라서 "이미 요약함"의
 *    기준이 성립하지 않는다. 거짓 상태를 만드느니 상태를 안 만든다.
 */
export function DecisionIcon({ size = 21 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 16 ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.6 6.9h9.6M3.6 12h9.6M3.6 17.1h5.6" />
      <path d="M14.9 14.9l2.5 2.5 4.2-5.2" />
    </svg>
  );
}
