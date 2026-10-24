# 사이 디자인 시스템 v2 — 「Interval」 (시안, 2026-10-24)

구현: `src/styles/tokens.css` · `src/styles/motion.css` · `src/content/content.css`(콘텐츠 팝업, 1차 적용)
검토 도구: `design-harness/` (`npm --prefix design-harness run dev` → http://127.0.0.1:5199/, `?theme=dark` · `?scene=<id>` · `?v=1` 이전 시안 비교)

## 0. 금지 (모든 규칙보다 우선)

| # | 금지 | 이유 |
|---|---|---|
| 1 | 색을 장식으로 쓰기. 6개 뜻 색은 §2 표의 뜻에만 쓴다 | 색이 뜻이어야 경고가 경고로 읽힌다 |
| 2 | 원색(`--seam` `--kept` `--dusk` `--check` `--fault`)을 **글자**에 쓰기 → `-deep` | AA 4.5:1 |
| 3 | `--seam` 위에 흰 글자 (4.31:1) → 채움+글자는 `--seam-strong` + `--on-seam` | AA |
| 4 | `--faint`를 글자에 쓰기 | 선·트랙 전용 |
| 5 | 주 동작 버튼을 색으로 칠하기. 주 동작은 **잉크 채움 하나** | 주황·초록 버튼이 섞이면 어느 게 주 동작인지 흐려졌다(v1) |
| 6 | 웹폰트를 이름으로 부르거나 콘텐츠 스크립트에 싣기 | §3 |
| 7 | transform·opacity·clip-path 밖의 속성을 반복 애니메이션 | 레이아웃 재계산 |
| 8 | 결과 화면에 무한 반복 모션 | 무한 반복은 「기다리는 중」(로딩·hover 로고)에만 |
| 9 | 등장 지연 합계 300ms 초과 · 모션 때문에 읽기/클릭 대기 | 읽기를 막지 않는다 |
| 10 | 개인 숫자 점수 · 국가 단위 단정 (Spec 필수 9) | 긴급도 막대는 **3단 서술 단계**(Low·Normal·High)이지 점수가 아니다 |
| 11 | 접근 경로를 hover에 걸기 | 2026-08-14 실측 — hover는 장식만 |
| 12 | JS가 같은 값으로 계산하는 크기 변경 (팝업 폭 clamp, 430px, gap 10px, FAB 42px) | `SaiOverlay.jsx` 상수와 같이 바꾸지 않으면 화면 밖으로 잘린다 |

## 1. 콘셉트

**사이 = 사람·언어·시간대 「사이」의 간격.** 로고는 이미 그것을 말한다 — 어긋난 두 바가 정렬되고 아래 바가 둘을 받친다(SHIFT).
v2는 이 동작 하나를 제품 전체의 문법으로 키운다.

- **시그니처 「SHIFT 이음선」**: 두 개의 2px 바(잉크·이음선 빨강).
  - 로딩: 두 바가 서로를 향해 미끄러졌다 벌어진다 — 두 쪽 사이에서 맞추는 중. (가짜 진행률 아님)
  - 결과: 바가 맞물리고(스냅) 그 **아래에서** 교정문이 위 가장자리부터 드러난다(`sai-emerge`).
  - 뜻 풀기: 직역(표면) 아래에서 실제 의도가 나온다. 체감 긴급도는 **두 막대**(표면·실제) — 실제 막대가 표면 길이에서 출발해 실제 길이로 자란다. 두 막대의 어긋남 = 표면과 실제의 차이.
  - 플로팅 버튼: 뜰 때 로고가 한 번 맞물린다(settle). hover 동안은 원본 3초 루프.
- **두 쪽의 색**: 내 쪽 = 잉크(Graphite) · 상대 쪽 = Dusk(남색, 상대 시각·퇴근 시간대·뜻 풀기·Low) · 그 사이 = Seam(로고 빨강, 사이의 목소리).
- **감행한 위험**: 브랜드 주황(#FF6100)과 초록 주 버튼을 버리고 **주 동작을 잉크 하나**로, 강조는 로고 빨강 한 가지로 줄였다. 화면이 조용해지는 대신 「빨강이 보이면 사이가 말하는 것」이 된다. 되돌리기는 토큰 한 줄(`--seam`).

### 일부러 뺀 것
- 그라데이션 배경·유리 효과(푸터의 8px blur만 기능용 — 스크롤 시 뒤 글자 차단), 장식 아이콘, 바운스 큰 등장(v1 `cubic-bezier(.2,.9,.3,1.2)`), 버튼마다 다른 색, 주황 스위치.
- 웹폰트(§3). 디스플레이 서체가 없는 대신 위계는 굵기·크기·자간·모노 숫자로 만든다.

## 2. 색 토큰

### 2-1 뜻 색 6개

| 토큰 | 이름 | 뜻 | 라이트 | 다크 | 글자용 `-deep` (라이트 대비) |
|---|---|---|---|---|---|
| `--ink` | Graphite | 본문 · 주 동작 채움 · 켜진 스위치 · 선택된 칩 | `#171A21` (16.95:1) | `#EEF0F3` | — |
| `--seam` | Seam | 사이 자신 — 로고 액센트, 로딩·이음선, 포커스 고리, Critical, 추천 | `#E5361B` | `#FF5A3C` | `#B42612` (6.34 · tint 5.54) |
| `--kept` | Kept | 지켜진 것 — 용어집, 보존된 기한·숫자, Zero Retention 표시 | `#0E8A5F` | `#2FBF86` | `#0A6E4B` (6.11 · tint 5.51) |
| `--dusk` | Dusk | 상대 쪽 — 상대 시각, 퇴근 시간대, 예약, 뜻 풀기·회신 배지, Low | `#3446B8` (흰 글자 7.74) | `#8C9BFF` | `#2B3A9E` (9.29 · tint 8.04) |
| `--check` | Check | 보내기 전 확인 — 숫자·이름·빈칸·누락·오해 소지·목업 표시 | `#D98A00` | `#F2B23A` | `#8A5300` (6.16 · tint 5.65) |
| `--fault` | Fault | 실패·차단 — 교정 실패, 민감정보 차단, 입력 오류 | `#C81E45` (흰 글자 5.63) | `#FF6B88` | `#A3173A` (7.46) |

채움 위 글자: `--on-ink` · `--on-seam`(라이트 흰/다크 잉크) · `--on-dusk`(같음). tint = `color-mix(oklab, 색 9~14%, surface)`.

### 2-2 바닥·글자

| 토큰 | 이름 | 라이트 | 다크 | 비고 |
|---|---|---|---|---|
| `--bg` | Fog | `#E9ECF0` | `#0D0F13` | 패널 바닥 |
| `--surface` | Porcelain | `#FBFCFD` | `#16191F` | 팝업·카드 |
| `--sunken` | Mist | `#EFF2F5` | `#1F232B` | 트랙·접힌 섹션·인풋 |
| `--raised` | — | `#FFFFFF` | `#232831` | 메뉴·토스트 |
| `--sub` | Slate | `#4A5361` (7.57) | `#C2C8D0` (10.45) | 보조 글자 |
| `--mut` | Pewter | `#5B6472` (5.82 · sunken 5.28) | `#98A1AD` (sunken 6.03) | 라벨·캡션 — 글자 최저선 |
| `--faint` | — | `#CFD4DB` | `#3A404B` | 🔴 선 전용 |
| `--border` / `--border-strong` / `--line` | — | 잉크 9% / 18% / 12% | 흰 9% / 18% / 12% | |

### 2-3 v1 별칭 (사이드패널·결정 화면 이전까지 유지 — B단계가 지운다)

| v1 | → v2 |
|---|---|
| `--o` `--primary-orange` | `--seam` |
| `--g` `--primary-green` | `--kept` |
| `--r` `--primary-red` | `--fault` |
| `--o-deep` `--g-deep` `--r-deep` | `--seam-deep` `--kept-deep` `--fault-deep` |
| `--o-tint` `--g-tint` `--r-tint` | `--seam-tint` `--kept-tint` `--fault-tint` |
| `--sai-risk-ink` | `--check-deep` |
| `--shadow` | `--e2` |

🔴 주의: 별칭 때문에 사이드패널의 **주황 버튼은 지금 이음선 빨강**으로 보인다(`--o`). B단계가 §7 규칙(주 동작=잉크)으로 옮긴다.

## 3. 글자

| 역할 | 토큰 | 서체 | 크기 / 굵기 | 쓰는 곳 |
|---|---|---|---|---|
| 본문 | `--font-sans` | OS 기본: `-apple-system`(SF+Apple SD Gothic Neo) · `Segoe UI Variable Text`/`Segoe UI` + `Malgun Gothic` · `Noto Sans KR` | — | 전부 |
| 데이터 | `--font-mono` | `Cascadia Mono` · `SF Mono` · `ui-monospace` · `Consolas` · `D2Coding` | — | 시각·`+1일`·예약 시각·`[URGENT]`·`[REDACTED]` 미리보기·번호·카운트 |
| 제목(경고) | `--t-title` | sans | 17 / 750, 자간 -0.01em, `text-wrap: balance` | 민감정보·하소연 제목 |
| 결과 | `--t-lead` | sans | 15 / 400(교정문), 650(실제 의도), 행간 1.6 | 교정문·실제 의도 |
| 본문 | `--t-body` | sans | 13.5 | 직역·초안 |
| 보조 | `--t-small` | sans | 12.5 | 설명 |
| 캡션 | `--t-caption` | sans | 11.5 / 600~700 | 라벨·근거·버튼 안 칩 |
| 마이크로 | `--t-micro` | sans | 10.5 / 600~700 | 태그·배지 |
| 워드마크 | — | sans | 12.5 / 800, 자간 0.08em | `S·AI` |

**웹폰트를 쓰지 않는 근거**
1. 콘텐츠 스크립트는 Shadow DOM 안이다 — Chrome은 shadow root 안의 `@font-face`를 무시한다(알려진 동작 — 이 작업에서 실측하지 않음). 쓰려면 호스트 **문서**에 등록해야 하고(남의 페이지 폰트 목록을 건드림), `web_accessible_resources`로 폰트 파일을 노출해야 한다.
2. 한글 웹폰트는 수 MB다. 모든 페이지에서 도는 확장에 실을 무게가 아니다.
3. 🔴 **사용자가 설치한 서체를 이름으로 부르지 않는다** (2026-10-24 실측): 이 PC의 `Pretendard`는 한 굵기만 설치돼 400·700 폭이 같았고(337.8px) 본문이 전부 굵게 보였다. `Pretendard Variable`은 없었다. v1 토큰은 Pretendard를 첫 순위로 적었지만 **상속 글자에는 적용되지 않았던 것으로 보인다**(하네스 `?v=1` 렌더에서 본문은 브라우저 기본 서체, `font-family`를 직접 지정한 버튼만 Pretendard — 호스트 인라인 `all:initial`이 `:host`의 font-family를 이긴 것으로 추정, 색 상속 문제(2026-08-20)와 같은 원인). v2는 뿌리 컨테이너가 서체를 다시 세운다 — 그래서 서체 목록이 실제로 적용되기 시작했고, 그 때문에 OS 서체로 바꿨다.
4. Malgun Gothic은 400/700 두 굵기뿐이다 — 600·650·750은 700으로 그려진다. 위계는 굵기 2단 + 크기 + 색으로 만든다.

## 4. 간격 · 모양 · 깊이

| 토큰 | 값 | 비고 |
|---|---|---|
| `--space-1..6` | 4 · 8 · 12 · 16 · 20 · 24 | 4pt |
| `--gutter-popup` | 18px | 팝업 좌우 여백(모든 줄이 이 선에 맞는다) |
| `--radius-xs/sm/md/lg/xl/pill` | 4 · 6 · 10 · 14 · 18 · 999 | 팝업 18, 섹션 14, 버튼 10, 칩 pill |
| `--e1` | 2단 그림자, 작음 | 플로팅 버튼 |
| `--e2` | 3단 그림자 + 1px 진한 테두리 | 팝업·메뉴·토스트 — 흰 페이지·어두운 페이지 어디서나 경계가 보이게 테두리를 함께 쓴다 |

경고 형태 규칙: **우리가 내린 판정** = 채운 상자(긴급도 알림·URGENT·요정) · **사용자가 고칠 것** = 왼쪽 3px 띠 + 옅은 바탕(누락·숫자·이름·빈칸·폴백).

## 5. 모션

### 5-1 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| `--dur-press` | 90ms | 누름 scale(0.92~0.97) |
| `--dur-quick` | 160ms | hover 색, 셰브런 |
| `--dur-enter` | 280ms | 팝업·블록 등장, 스위치 노브, 세그먼트 표시 |
| `--dur-reveal` | 520ms | 결과 드러남, 이음선 맞물림 |
| `--dur-loop` | 1600ms | 로딩 이음선 1주기 |
| `--stagger` | 35ms | 블록 순차 간격(상한 6단 = 210ms) |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | 기본 |
| `--ease-snap` | `cubic-bezier(.34,1.36,.5,1)` | 「맞물림」 — 로고·이음선·세그먼트·노브·긴급도 막대에만 |
| `--ease-inout` | `cubic-bezier(.65,0,.35,1)` | 로딩 왕복 |
| `--ease-in` | `cubic-bezier(.5,0,.75,0)` | 퇴장(현재 미사용 — 팝업은 즉시 닫힌다) |

### 5-2 안무 (팝업이 열릴 때)

| 시각 | 무엇 | keyframes |
|---|---|---|
| 0ms | 팝업 셸: 아래 10px·98.5% → 제자리 | `sai-pop` 280ms |
| 0~210ms | 직계 블록 순차 상승 6px (35ms 간격) | `sai-rise` |
| 결과 도착 | 이음선 두 바 ±18% → 맞물림 | `sai-seam-a/b-align` 520ms snap |
| +120ms | 교정문이 위 가장자리부터 드러남 | `sai-emerge` 520ms |
| +160ms | 확인 경고 띠가 위→아래로 그어짐 | `sai-draw-y` 260ms |
| 뜻 풀기 +140ms | 실제 의도 드러남, 왼쪽 Dusk 띠 그어짐(+180) | `sai-emerge`, `sai-draw-y` |
| 뜻 풀기 +200ms / +520ms | 표면 막대 그려짐 → 실제 막대가 표면 길이에서 실제 길이로 | `sai-draw-x`, `sai-gap-shift`(`--from`) |
| 민감정보 | 흔들지 않는다 — 옆 10px에서 와서 -2px 지나 멈춤 | `sai-halt` 360ms |
| 토스트 | 아래 14px → 제자리, 왼쪽 이음선 띠 자람 | `sai-toast-rise`, `sai-draw-y` |

마이크로: 주 버튼 hover = 바닥에 이음선 2px가 왼→오 지나감 · 세그먼트 표시가 칸 사이를 미끄러짐(`:has()`) · 메뉴 아이콘 가운데 줄이 열리면 정렬 · 저장 문구 hover = 왼쪽 이음선 · 피드백 👍 hover 1px 상승.

### 5-3 모션 최소화 (`prefers-reduced-motion: reduce`)
- 전역: 모든 animation/transition 0.01ms·지연 0·1회 → **최종 상태**로 즉시 표시(`motion.css`).
- 로딩 이음선: `animation: none` → 두 바가 맞물린 **정지 선**으로 남는다(사라지면 「기다리는 중」 신호가 없어진다).
- 순환 로딩 문구(1.4초)는 텍스트 변경이라 그대로 둔다.

## 6. 로고

`SaiMark.jsx` 형태·색 그대로(라이트 잉크 바 / 다크 크림 바 / 액센트 `#EC3013` 고정). v2가 바꾼 것은 **쓰임**뿐:
- 플로팅 버튼 등장 시 1회 맞물림(`sai-logo-settle-*`, 560ms snap) → hover/포커스 중 원본 3초 루프.
- 로딩에는 마크를 쓰지 않는다(18px에서는 읽히지 않았다 — 2026-08-19). 대신 마크의 동작을 전체 폭 이음선으로 그린다.
- 버튼 배경은 `--sunken`(마크의 두 색이 어떤 페이지 위에서도 읽히게), hover 시 `--seam-tint`.

## 7. 컴포넌트

| 컴포넌트 | 클래스 | 규격 | 상태 |
|---|---|---|---|
| 주 버튼 | `.sai-button-primary`, `.sai-reply-copy`, `.sai-person-add` | 잉크 채움, `--on-ink`, 13/650, 8×14, r10 | hover: 바닥 이음선 / active: 0.97 / disabled: 45% |
| 보조 버튼 | `.sai-button-quiet` | 투명 + 안쪽 1px `--border-strong`, `--sub` | hover: `--sunken` + 잉크 |
| 텍스트 버튼 | `.sai-link`, `.sai-reply-plain`, `.sai-reply-ask-skip` | 밑줄 `--faint` | hover: 잉크 + 밑줄 이음선 |
| 칩 | `.sai-reply-intent`, `.sai-reply-ask-chip` | pill, 1px `--border-strong` | 추천 = 이음선 **점선** + 「추천」 / 선택 = 잉크 채움(선택이 추천을 이긴다) |
| 태그 | `.sai-recipient-tag`, `.sai-why-tag`, `.sai-missing-tag`, `.sai-reply-check-tag` | 10~10.5px pill | 색 = 뜻(§2) |
| 배지 | `.sai-badge` | pill | 다듬기=Seam · 뜻 풀기/회신=Dusk(`-green` 클래스) · 차단=Fault |
| 스위치 | `.sai-switch` | 30×18, 노브 14 | 켬 = 잉크, 노브 transform snap |
| 세그먼트 | `.sai-segment` | 같은 폭 3칸, 미끄러지는 표시 | Critical=Seam · Normal=잉크 · Low=Dusk |
| 카드(섹션) | `.sai-back`, `.sai-panel` | `--sunken`, r14 | 꺼짐 = 상자 없이 라벨+스위치 |
| 팝업 셸 | `.sai-popup` | `--surface`, 1px `--border-strong`, r18, `--e2` | 푸터 sticky + blur |
| 시계 | `.sai-clock` | 두 칸 + 세로 이음선, 모노 숫자 | 상대 퇴근 시간대 = 그 칸이 Dusk 채움 |
| 경고(확인) | `.sai-missing`, `.sai-blank` | 왼쪽 3px Check 띠(그어짐) + 5% 바탕 | — |
| 경고(실패) | `.sai-fallback`, `.sai-error` | Fault 띠 / Fault-deep 글자 | 접히지 않는다 |
| 민감정보 | `[role=alertdialog]`, `.sai-masked-preview` | Fault 테두리, 빗금 가장자리 + 모노 | `sai-halt` |
| 로딩 | `.sai-loading` | 문구 + 이음선 두 바 | §5-3 |
| 긴급도 막대 | `.sai-decode-gap-*` | 두 줄(표면·실제), 3칸 눈금 | 실제 막대 색 = 단계 색 |

## 8. 다크 모드
- 같은 토큰 이름을 `:root[data-theme='dark']` / `:host([data-theme='dark'])`에서 다시 정의한다. 컴포넌트 CSS에 다크 분기를 쓰지 않는 것이 원칙(예외 3개: 스위치 노브, 표면 막대, 테스트가 잠근 배지 규칙).
- 채움 위 글자는 `--on-*`로 뒤집힌다(다크의 이음선·Dusk 채움 위에는 어두운 글자).
- `color-scheme: dark`로 네이티브 select·스크롤바도 따라간다.
