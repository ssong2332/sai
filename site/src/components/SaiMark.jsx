/**
 * 사이 로고 마크 — 확장의 `src/assets/SaiMark.jsx`와 같은 형태(viewBox 188×96, 바 1u·간격 0.5u·어긋남 2u).
 * 🔴 확장 소스를 import하지 않는다 — 웹은 확장과 분리된 앱이다. 형태·색을 바꾸지 않는다.
 * 색: 바 `--bar`(라이트 그라파이트 / 다크 크림), 액센트 바 `--fact`(두 테마 고정 레드).
 */
/** `live`: 위 두 바가 엇갈렸다 맞물리기를 반복(시안 A2). 모션 줄이기면 멈춘다(base.css). */
export default function SaiMark({ size = 28, live = false, title = '사이' }) {
  return (
    <svg
      viewBox="0 0 188 96"
      width={size}
      height={Math.round(size * (96 / 188))}
      className={live ? 'sai-mark live' : 'sai-mark'}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      <rect x="14" y="20" width="118" height="16" fill="var(--bar)" className="mark-a" />
      <rect x="56" y="44" width="118" height="16" fill="var(--bar)" className="mark-b" />
      <rect x="14" y="68" width="160" height="16" fill="var(--fact)" className="mark-c" />
    </svg>
  );
}
