# 사이 디자인 시스템 — 시안 A2 (2026-10-24 사용자 승인)

v2 「Interval」(색 = 뜻, 주 동작 = 잉크)을 그대로 두고 **글자·모양·움직임·여백**을 A2 시안으로 키웠다.
기준 시안: `docs/design/reference-a2.html` (원본 `docs/design-options/sai-design-a2.html` 사본).

구현: `src/styles/tokens.css` · `src/styles/motion.css` · `src/styles/fonts.css` · `src/lib/saiFont.js` ·
`src/content/content.css` · `src/sidepanel/sidepanel.css` · `src/decisions/decisions.css`
검토 도구: `design-harness/` — `npm --prefix design-harness run dev` →
`http://127.0.0.1:5199/`(팝업, `?scene=<id>`) · `/sidepanel.html` · `/decisions.html` (모두 `?theme=dark`).
🔴 하네스 화면이 맞아도 실브라우저 unpacked 확인 없이 「동작한다」고 하지 않는다(CLAUDE.md).

## 0. 금지 (모든 규칙보다 우선)

| # | 금지 | 이유 |
|---|---|---|
| 1 | 색을 장식으로 쓰기. 뜻 색 6개는 §2 표의 뜻에만 | 색이 뜻이어야 경고가 경고로 읽힌다 |
| 2 | 원색(`--seam` `--kept` `--dusk` `--check` `--fault`)을 **글자**에 → `-deep` | A2 시안 원값은 `--seam` 3.79:1·`--kept` 3.39:1로 AA 미달 |
| 3 | 흰 글자를 `--seam` 위에 → `--seam-strong`(5.51:1) | AA |
| 4 | 주 동작을 색으로 칠하기. 주 동작 = **잉크 채움 하나** | v1에서 주 동작이 흐려졌다 |
| 5 | 설치 서체를 이름으로 부르기(`Pretendard`) · 원격 웹폰트 | §3 |
| 6 | 번들에 없는 굵기(500·650·750 등) | 400·600·700·800만 있다 — 브라우저가 몰래 바꾼다 |
| 7 | transform·opacity(·clip-path) 밖의 속성 애니메이션 | 레이아웃 재계산 |
| 8 | 결과 화면의 무한 반복 모션 | 반복은 「기다리는 중」(로더·hover 로고)만 |
| 9 | 등장 지연 합계 300ms 초과 | 읽기·클릭을 막지 않는다 |
| 10 | 개인 숫자 점수 · 국가 단위 단정 (Spec 필수 9) | 긴급도 막대 끝 글자는 **서술 단계**(Low·Normal·High) |
| 11 | 접근 경로를 hover에 | hover는 장식만 |
| 12 | JS가 같은 값으로 계산하는 크기 변경(팝업 폭 clamp·430px·gap 10px·FAB 42px) | `SaiOverlay.jsx` 상수와 함께 바꾸지 않으면 화면 밖으로 잘린다 — A2는 이 값을 **하나도 바꾸지 않았다** |
| 13 | v1 별칭(`--o` `--g` `--r` `--primary-*` `--*-tint`(v1) `--shadow` `--sai-mut` `--seam-line` `--sai-risk-ink`) 되살리기 | 2026-10-24 삭제(grep 0건 확인 후) |

## 1. 판정표 — 어떤 색을 쓰나

| 이 요소가 말하는 것 | 색 | 예 |
|---|---|---|
| 내가 누를 주 동작 · 선택됨 · 켜짐 | `--ink` 채움 | 적용하기, 켜진 스위치, 선택 칩, 동작 칩(`.chip-orange`) |
| 사이 자신 · 지켜야 할 사실(숫자·기한·이름) · Critical | `--seam` | 로고, 맞물린 막대, 다듬기 태그, 「유지」 칩 점, Critical 글자 |
| 용어집 · 지킨 용어 · Zero Retention | `--kept` | 용어 띠(`.sai-glossary`), Zero Retention 점, 확정 태그 |
| 상대 쪽 · 시간 · Low | `--dusk` | 상대 시각 알약, 퇴근 요정, 뜻 풀기 태그, 회의 시간, 포커스 고리 |
| 보내기 전 확인 · 미확정 | `--check` | 누락·숫자·이름·빈칸 경고, 저장 전 요약, 미확정 행 |
| 실패 · 차단 | `--fault` | 교정 실패, 민감정보 차단, 삭제 |
| 표에 없는 경우 | — | 임의로 정하지 말고 표에 행을 추가할지 묻는다 |

## 2. 색 토큰 (A2 값)

| 토큰 | 라이트 | 다크 | 글자용 `-deep` (라이트) |
|---|---|---|---|
| `--bg` / `--surface` / `--sunken` | `#F2F4F6` / `#FFFFFF` / `#F2F4F6` | `#101318` / `#1B1F27` / `#242A33` | — |
| `--ink` / `--sub` / `--mut` | `#191F28` / `#4E5968` / `#626D7A`¹ | `#F2F4F6` / `#B0B8C1` / `#8B95A1` | — |
| `--faint` (선 전용) | `#D1D6DB` | `#333B46` | — |
| `--seam` · tint | `#F04419` · `#FFEEE8` | `#FF6A45` · `#3A211B` | `#C4320E` (흰 5.51 · tint 4.89) |
| `--kept` · tint | `#0E9F6E` · `#E6F7F0` | `#33C38E` · `#15302A` | `#0A7A55` (tint 4.82) |
| `--dusk` · tint | `#3D5AFE` · `#ECEFFF` | `#8C9EFF` · `#1E2440` | `#3049D9` (tint 5.96) |
| `--check` · tint | `#E59500` · `#FFF6E0` | `#FFB938` · `#3A2E14` | `#8A5300` (tint 5.88) |
| `--fault` | `#C81E45` | `#FF6B88` | `#A3173A` |

¹ A2 원값 `#6B7684`는 `--sunken` 위 4.19:1(AA 미달)이라 `#626D7A`(4.78)로 한 단계 진하게 했다.
그림자: `--e1`(카드) · `--e3`(팝업·토스트, A2) · `--knob-shadow`(세그먼트 노브). 팝업은 `--e3`에 1px `--line` 고리를 겹친다(흰 페이지 위 가장자리).

## 3. 글자

| 역할 | 크기 / 굵기 | 쓰는 곳 |
|---|---|---|
| 결과 `--t-lead` | **21 / 600**, 자간 -0.02em, 행간 1.5 (좁은 폭 18) | 교정문 |
| 실제 의도 | 18 / 700 | 뜻 풀기 결과 |
| 제목 `--t-title` | 19 / 800, 자간 -0.03em | 민감정보·하소연 |
| 본문 `--t-body` | 14.5 | 직역·역번역·버튼 |
| 보조 `--t-small` / 캡션 `--t-caption` / 마이크로 `--t-micro` | 13.5 / 12.5 / 11.5 | 설명 / 라벨·칩 / 배지 |
| 사이드패널 숫자 `--t-display` | 30 / 800, 자간 -0.04em, `tabular-nums` | 「오늘의 사이」 |
| 시각·개수 | sans + `font-variant-numeric: tabular-nums` (모노 서체 대신) | 시계 알약, 회의 시간, 개수 배지 |
| 모노 `--font-mono` | — | `[URGENT]`, `[REDACTED]` 미리보기, 인증 코드 |

### 3-1 번들 서체 결정 (2026-10-24)

| 항목 | 결정 | 근거 |
|---|---|---|
| 서체 | Pretendard v1.3.9 **공식 배포본** `web/static/woff2-subset`(KS X 1001) — Regular·SemiBold·Bold·ExtraBold | 요청은 「KS X 1001 서브셋 **가변** woff2」였으나 npm 1.3.9에는 가변 서브셋 파일이 없다(가변은 전체 2.06MB 또는 92조각 dynamic-subset뿐). 직접 서브셋하면 OFL의 **Reserved Font Name(Pretendard)** 때문에 수정본이 되어 이름을 쓸 수 없다 → 공식 파일 그대로 4굵기를 골랐다 |
| 크기 | 4파일 1,078,428 B(+ `Pretendard-OFL.txt` 4,419 B) | 가변 전체(2,057,688 B)의 52% |
| 이름 | `SaiPretendard` (고유) | 설치된 `Pretendard`(한 굵기만 깔린 PC — v2 실측)와 섞이지 않고, 페이지 서체를 바꾸지 않는다 |
| 콘텐츠 팝업 | `src/lib/saiFont.js` — `FontFace(url(chrome.runtime.getURL(...)))`를 **호스트 문서** `document.fonts`에 등록. Shadow root 안 `@font-face`는 쓰지 않는다 | 문서에 등록한 서체는 그 문서의 shadow 트리에서 쓰인다 |
| 지연 로드 | URL 출처 `FontFace`는 그 굵기 글자가 그려질 때 처음 내려받는다 | 하네스 실측: 등록만 한 페이지에서 woff2 요청 0건 · 4개 모두 `unloaded` |
| 노출 | manifest `web_accessible_resources: fonts/*.woff2` (`<all_urls>`) | 페이지 쪽에서 읽어야 한다. 🔴 남는 위험: 페이지가 이 경로로 확장 설치 여부를 짐작할 수 있다(crxjs가 이미 `assets/*.js`를 같은 범위로 노출하고 있어 새 위험은 작다) |
| 확장 페이지 | `src/styles/fonts.css`의 `@font-face url('/fonts/…')` | 빌드 시 `public/fonts/` → `dist/fonts/` |
| 실패 시 | `--font-sans` 다음 순위(OS 서체)로 그린다. `registerSaiFont`는 던지지 않는다 | 고아 컨텍스트·CSP·미지원 |
| 미검증 | 실사이트(Slack·Gmail·GitHub 등) CSP 아래에서 서체가 실제로 내려받아지는지 | 하네스(로컬)에서만 확인 — unpacked 실확인 필요 |

## 4. 모양 · 간격

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `--radius-xl` / `--radius-2xl` | **20 / 28** | 팝업·카드 / 큰 면(결정 화면 동의 카드) |
| `--radius-lg` / `--radius-md` / `--radius-sm` | 16 / 14 / 10 | 안쪽 상자 / 버튼·입력 / 작은 칩 |
| `--gutter-popup` | 20px | 팝업 좌우 여백 |
| 버튼 | 팝업 44px · 사이드패널 42px · r14 · 14.5/700 | 주 = 잉크 채움, 보조 = `--sunken` 면 |
| 스위치 | 사이드패널 **52×32**(노브 26) · 팝업 40×24(노브 18, 같은 비율) | 팝업은 남의 화면이라 한 단계 작게 |
| 세그먼트 | 트랙 `--sunken` r13·안쪽 4px, 칸 높이 34, 흰 노브 r10 | 팝업 긴급도·사이드패널 용어집 출처 |

## 5. 모션

| 토큰 | 값 | 용도 |
|---|---|---|
| `--spring` | `cubic-bezier(.34,1.56,.64,1)` | 노브·세그먼트·탭·막대·누름 복귀 |
| `--out` | `cubic-bezier(.16,1,.3,1)` | 등장·드러남 |
| `--dur-press` / `--dur-quick` / `--dur-enter` / `--dur-reveal` / `--dur-loop` | 250 / 200 / 450 / 600 / 1100ms | |
| `--stagger` | 40ms (상한 6단 = 240ms) | 블록 순차 등장 |

| 장면 | 동작 | 구현 |
|---|---|---|
| 누름 | scale(.96) → 스프링 복귀 (A2 `.press`) | 버튼·칩·탭·세그먼트·스위치·닫기 `:active` |
| 로딩 | 두 막대(잉크·이음선, 5px·58%)가 엇갈려 오간다 | `.sai-loading::before/::after` + `sai-bars-a/b` |
| 결과 도착 | 두 막대가 전체 폭으로 **맞물린다**(잉크 12%·이음선) → 그 아래 결과가 8px 아래에서 선다 | `.sai-ainote:has(+ .sai-refined)` + `sai-bars-lock-*`, `sai-reveal` |
| 뜻 풀기 | 머리에 맞물린 막대 → 실제 의도 드러남 → 표면 막대가 0에서, 실제 막대가 **표면 길이에서 실제 길이로** 스프링 | `.sai-decode-body:has(> .sai-decode-gap)`, `sai-spring-x`, `sai-gap-shift`(`--from`) |
| 세그먼트·탭 | 노브가 칸 사이를 스프링으로 미끄러진다 — JS 없이 `:has()` | `.sai-segment::before`, `.panel-tabs::before`, `.segment::before` |
| 스위치 | 노브 translateX 스프링 | `.sai-switch-knob` |
| 「오늘의 사이」 | 이전 값→새 값 900ms 숫자 굴리기(ease-out cubic) — **표시만** | `RollingNumber` (`src/sidepanel/App.jsx`) |
| 탭 전환 | 카드가 6px 아래에서 40ms 간격으로 선다 | `.panel-body > *` |
| 토스트 | 잉크 알약이 14px 아래에서 스프링, 왼쪽 이음선 띠 | `.sai-toast`, `.toast` |

### 5-1 모션 최소화 (`prefers-reduced-motion: reduce`)
- 전역: animation/transition 0.01ms·지연 0·1회 → **최종 상태** 즉시(`motion.css`).
- 로딩 막대: 반복 없음 → **맞물린 정지 선**(「기다리는 중」 문구는 남는다).
- 숫자 굴리기: 즉시 최종값.

## 6. 로고
`SaiMark.jsx` 형태·색 그대로. 플로팅 버튼 등장 시 1회 맞물림, hover/포커스 동안 원본 SHIFT 루프(v2와 같다).

## 7. 레이아웃 (A2)

| 화면 | 구조 |
|---|---|
| 다듬기 팝업 | 머리줄(마크·`S·AI`·태그 … 문체·닫기) → **긴급도 세그먼트 전체 폭**(CSS `order`, DOM 순서 그대로) → 받는 사람 줄(선택·팀 + 내 시각 · **상대 시각 Dusk 알약** + 서술 태그 칩) → 근거 → 맞물린 막대 → **결과 21/600** → 경고 → 역번역 상자(`--sunken` r16) → 푸터(Zero Retention 줄 + **전체 폭 버튼 줄**, 주 동작이 가장 넓다) |
| 뜻 풀기 | 머리줄 → 맞물린 막대 → 직역 → 실제 의도(Dusk 상자, 띠 없음) → 체감 긴급도(트랙 12px, 줄 끝 단계 이름) → 요구 행동 → 회신 칩(`--sunken`, 추천 = 이음선 점선, 선택 = 잉크) |
| 사이드패널 | 흰 머리 블록(헤더 + 탭 4칸, 미끄러지는 노브) · `--bg` 본문 · 흰 카드 r20 · 접이 섹션 안 항목은 `--sunken` 카드 |
| 결정 화면 | 흰 카드 r20/28, 그림자 `--e1`, 확인 필요 = Check |

## 8. 다크
같은 토큰 이름을 `:root[data-theme='dark']` / `:host([data-theme='dark'])`에서 다시 정의한다(A2 다크 값). 컴포넌트 CSS의 다크 분기는 예외 3개뿐(테스트가 잠근 배지 규칙, 표면 막대 투명도, 스위치는 `--on-ink`로 자동).
