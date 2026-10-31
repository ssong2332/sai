# 스토어 그래픽 자산 (L21)

| 파일 | 규격 | 원본 |
|---|---|---|
| `promo-small-440x280.png` | 작은 프로모션 타일 440×280 (필수) | `promo-tile.html` |
| `screenshot-1-refine.png` · `-2-decode` · `-3-sidepanel` · `-4-dashboard` | 스크린샷 1280×800 (24비트 PNG) | 무대 `stage.html` 위 실확장 0.1.54 캡처(2026-10-29) → `fit-screenshot.ps1` |

## 다시 만들기 (PowerShell, 저장소 루트)

```
$src = (Resolve-Path 'docs/store/promo-tile.html').Path; $out = Join-Path (Resolve-Path 'docs/store').Path 'promo-small-440x280.png'; $tmp = Join-Path $env:TEMP 'sai-chrome-promo'; & 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files "--user-data-dir=$tmp" --window-size=440,280 "--screenshot=$out" ("file:///" + ($src -replace '\\','/'))
```

- 🔴 `--force-device-scale-factor=1` — 없으면 화면 배율대로 커져 440×280이 아니게 된다.
- 🔴 `--allow-file-access-from-files` — 없으면 `public/fonts` Pretendard를 못 읽어 다른 글꼴로 그린다.
- 색·글꼴은 `src/styles/tokens.css`·`public/fonts`, 로고 좌표는 `src/assets/SaiMark.jsx`와 같게 둔다.

## 스크린샷 (1280×800, 1~5장)

| # | 장면 | 어디서 | 하는 법 |
|---|---|---|---|
| 1 | 다듬기 | 무대 페이지 | 아래 한국어 초안을 선택 → 사이 버튼 → 다듬은 영어가 보일 때 |
| 2 | 뜻 풀기 | 무대 페이지 | 위 영어 메시지를 선택 → 사이 버튼 → 뜻 풀기 결과가 보일 때 |
| 3 | 사이드 패널 | 무대 페이지 + Alt+S | 홈 탭. 🔴 설정(톱니)은 열지 않는다 — 구글 계정 메일이 보인다 |
| 4 | 팀 대시보드 | 확장 대시보드 | 시험 팀. 🔴 팀원 이메일·실명이 보이면 찍지 않는다 |
| 5 | 저장 문구 (선택) | 무대 페이지 + Alt+X | 입력창에 커서 → Alt+X 목록이 보일 때 |

🔴 실제 사람 이름·메일 주소·회사 메일이 화면에 없어야 한다. 무대 페이지의 인물·대화는 모두 지어낸 것이다.

**무대 띄우기**(저장소 루트, 끝나면 Ctrl+C): `npx vite docs/store --port 5300 --strictPort` → `http://localhost:5300/stage.html`

**찍기**: 크롬 창을 최대화하고 Win+Shift+S로 창 영역을 찍어 파일로 저장한다. 1280×800에 정확히 맞출 필요는 없다 — 아래 스크립트가 맞춘다.

**규격 맞추기**(비율 유지 · 남는 칸 #f2f4f6 · 투명도 없는 24비트 PNG):

```
powershell -File docs/store/fit-screenshot.ps1 -In <찍은 파일> -Out docs/store/screenshot-1.png
```

넓은 창은 그대로 줄이면 글자가 작아진다 — `-CropX <왼쪽 px> -CropWidth <폭 px> -CropHeight <높이 px>`로 먼저 자른다(셋 다 선택, 원본 픽셀). 2026-10-29에 쓴 값: 1번 `-CropX 265 -CropWidth 1430 -CropHeight 894` · 2번 `-CropX 270 -CropWidth 1459` · 3번 `-CropX 270` · 4번 자르지 않음.

## 대화 상대 감지 시험 (2026-11-01)
무대 주소(`localhost:5300`)에서만 대화 상대 감지가 켜진다(`src/lib/siteGate.js` DEV_STAGE_HOSTS). 왼쪽 대화를 누르면 바뀌고, `?layout=`으로 배치를 고른다.

| 배치 | Daniel | Mei | Priya | 결과 |
|---|---|---|---|---|
| `store`(주소에 없음 — 촬영 화면) | 후보 없음 | 후보 없음 | 후보 없음 | ✔ 기대대로(「이름 · 시각」은 규칙 N1이 거름) |
| `name` (이름 줄 → 본문 → 시각) | ＋ Daniel Weber | ＋ Mei Tanaka | ＋ Priya Raman | ✔ |
| `colon` (「이름: 내용」) | ＋ Daniel Weber | ＋ Mei Tanaka | ＋ Priya Raman | ✔ |
| `mail` (「이름 <주소>」) | ＋ Daniel Weber | ＋ Mei Tanaka | ＋ Priya Raman | ✔ |
| `name`, 새로 열지 않고 Daniel → Priya | ＋ Daniel Weber → ＋ Priya Raman | | | ✔ 상대를 바꾸면 제안도 바뀐다 |

실확장 0.1.65 · 운영 Worker · 받는 사람 미등록 상태(자동 선택은 등록된 사람이 있어야 해서 이번에는 보지 않음).
🔴 발견: 무대 시험 막대 「배치(시험용): …」가 `이름: 내용`으로 읽혀 후보에 떴다(콜론을 빼서 해결). **실제 사이트에서도 「라벨(괄호): 내용」 줄은 사람 이름으로 잡힐 수 있다**(괄호는 `이름:` 구조 안에서는 거르지 않음) — 대화형 8곳 한정이라 영향은 작다(추정).
