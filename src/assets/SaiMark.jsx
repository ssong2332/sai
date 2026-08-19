/**
 * 사이(Sai) 로고 마크 — "SHIFT" (어긋남에서 정렬로).
 *
 * 출처: claude.ai/design 프로젝트 `ef670805-66e2-4372-b075-86268295d1c7`의
 * `MEDIATE 로고 03 SHIFT 전개.dc.html` (2026-08-13 임포트, 사용자 지시).
 *
 * 🔴 **원본 색 그대로 쓴다** (2026-08-13 사용자 재확인 — 처음엔 Spec §6-1 팔레트로 재배색했으나
 *    "로고 이미지 원본만 사용하자"는 지시로 되돌렸다). 문맥(해독 모드 등)에 따라 색을 바꾸지
 *    않는다 — 어디서나 같은 로고다. 원본의 라이트/다크 두 락업을 테마 전환에 맞춰 그대로 쓴다:
 *    라이트는 잉크색 바, 다크는 크림색 바, **액센트(하단) 바는 두 락업 모두 레드로 고정**
 *    (`--sai-logo-bar`/`--sai-logo-accent`, `src/styles/tokens.css`에 정의 — 로고 전용 변수이며
 *    브랜드 accent 토큰(`--o`/`--g`)과는 별개다).
 * 🔴 형태(작도 규칙: 바 두께 1u·간격 0.5u·어긋남 2u, viewBox 0 0 188 96)도 원본 그대로다.
 * 🔴 3초 루프 모션(`animated`)은 원본 설계 의도를 그대로 따른다 — 원본 주석: "로고와 로딩 상태가
 *    같은 형태를 쓴다". `RefinePopup`·`DecodePopup`의 로딩 문구 옆에 쓴다.
 *
 * 두 개의 어긋난 바가 정렬되고 그 아래 바가 감싸는 구조 — "사람과 사람, 언어와 언어 사이를
 * 잇는다"는 제품 컨셉과 형태가 맞아떨어져서 그대로 가져왔다.
 *
 * @param {object} props
 * @param {number} [props.size] 렌더 폭(px). 높이는 원본 비율(96/188)로 자동 계산.
 * @param {boolean} [props.animated] true면 3초 루프 정렬 모션(로딩 상태 전용).
 * @param {string} [props.className]
 */
export default function SaiMark({ size = 20, animated = false, className }) {
  const classes = ['sai-logo-mark', animated ? 'sai-logo-mark-animated' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <svg
      viewBox="0 0 188 96"
      width={size}
      height={Math.round(size * (96 / 188))}
      className={classes}
      role="img"
      aria-label="사이"
    >
      <rect x="14" y="20" width="118" height="16" fill="var(--sai-logo-bar)" className="sai-logo-bar-a" />
      <rect x="56" y="44" width="118" height="16" fill="var(--sai-logo-bar)" className="sai-logo-bar-b" />
      <rect x="14" y="68" width="160" height="16" fill="var(--sai-logo-accent)" className="sai-logo-bar-c" />
    </svg>
  );
}
