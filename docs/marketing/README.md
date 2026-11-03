# 마케팅 자료

## 금지
- 🔴 결과 글은 실제 사이 응답·실제 화면만. 지어낸 결과를 넣지 않는다. 국가 단위 단정·개인 점수 표기 금지(Spec 필수 9).
- 🔴 게시는 사용자가 한다. 순서는 `LaunchPlan.md` 3절.

| 파일 | 내용 |
|---|---|
| `LaunchPlan.md` | 대상·말할 것·채널 순서·예산 |
| `LaunchPosts.md` | 채널별 글·캡션·대본(5절 인스타·쇼츠·Threads) |
| `assets/cards.html` | 카드뉴스 원본(`?s=a1`…`b6`) |
| `assets/video.html` · `assets/make_video.py` | 세로 영상 장면 원본 · 이어 붙이기 |
| `assets/ui-*.png` | 스토어 스크린샷 1·2번에서 잘라 낸 실제 팝업 |
| `out/` | 만든 결과(PNG 12장 · mp4 2편) |

## 다시 만들기 (PowerShell, 저장소 루트 — 2026-11-03 확인)
카드뉴스 12장:
```
$src = (Resolve-Path 'docs/marketing/assets/cards.html').Path -replace '\','/'; $out = (Resolve-Path 'docs/marketing/out').Path; $tmp = Join-Path $env:TEMP 'sai-chrome-cards'; foreach ($s in 'a1','a2','a3','a4','a5','a6','b1','b2','b3','b4','b5','b6') { & 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files "--user-data-dir=$tmp" --window-size=1080,1350 --virtual-time-budget=3000 "--screenshot=$out\card-$s.png" ("file:///" + $src + "?s=" + $s) 2>$null | Out-Null }
```
영상: 위와 같은 명령으로 `video.html`을 `--window-size=1080,1920`, 장면 `v1-1`…`v1-5`·`v2-1`…`v2-5`로 한 폴더에 렌더 → `python -I docs/marketing/assets/make_video.py <그 폴더> v1 docs/marketing/out/reel-1-decode.mp4` (v2도 같게).

🔴 장 번호는 쿼리(`?s=`)로 — 해시는 headless 스크린샷에서 무시돼 빈 장이 나왔다. 🔴 스크립트에서 전역 `top` 이름을 쓰지 않는다(window.top과 겹쳐 스크립트가 죽는다). 🔴 `--allow-file-access-from-files`를 빼면 글꼴·팝업 이미지를 못 읽는다.
