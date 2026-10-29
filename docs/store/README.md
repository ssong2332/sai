# 스토어 그래픽 자산 (L21)

| 파일 | 규격 | 원본 |
|---|---|---|
| `promo-small-440x280.png` | 작은 프로모션 타일 440×280 (필수) | `promo-tile.html` |

## 다시 만들기 (PowerShell, 저장소 루트)

```
$src = (Resolve-Path 'docs/store/promo-tile.html').Path; $out = Join-Path (Resolve-Path 'docs/store').Path 'promo-small-440x280.png'; $tmp = Join-Path $env:TEMP 'sai-chrome-promo'; & 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files "--user-data-dir=$tmp" --window-size=440,280 "--screenshot=$out" ("file:///" + ($src -replace '\\','/'))
```

- 🔴 `--force-device-scale-factor=1` — 없으면 화면 배율대로 커져 440×280이 아니게 된다.
- 🔴 `--allow-file-access-from-files` — 없으면 `public/fonts` Pretendard를 못 읽어 다른 글꼴로 그린다.
- 색·글꼴은 `src/styles/tokens.css`·`public/fonts`, 로고 좌표는 `src/assets/SaiMark.jsx`와 같게 둔다.
