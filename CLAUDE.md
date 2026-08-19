# CLAUDE.md — 사이 (Sai)

## 금지 (모든 규칙보다 우선)
- **메시지 본문을 서버·DB(Firestore)·Functions 로그에 저장 금지** (Zero Retention — Spec 필수 5). 저장 허용은 카운트·메타데이터·diff 수치뿐. 코드 리뷰 시 이 항목을 반드시 확인한다.
- API 키·비밀번호·토큰을 소스·문서·커밋 메시지에 쓰지 않는다. 비밀값은 `.env`에만, 커밋은 `.env.example`(플레이스홀더)만.
- 근거 없는 성공 보고 금지. jsdom/단위 테스트 green만으로 "동작한다" 판정 금지 — **확장 기능은 실브라우저 unpacked 로드 확인이 있어야 done** (`docs/reference/Lessons.md` #1).
- 요청받지 않은 수정·리팩토링·삭제 금지. 막히면 조용한 우회 대신 보고 후 승인.
- 개인 숫자 점수 표기 금지(Spec 필수 9 G1/G2) · 국가 단위 단정 서술 금지(3순위 참고까지만).

## 문서 위계
1. `docs/Spec.md` — **마스터 명세. 모든 충돌의 최종 승자.**
2. `docs/Tasks.md` — 태스크 분해·상태. done은 실행 증거 필수.
3. `docs/reference/Lessons.md` — 이전 프로젝트 이식 지식. Spec과 충돌하면 무시.
4. `docs/reference/c*.ts`, `TestCases-legacy.md` — 프롬프트·테스트 시드 자산.

## Project Overview
- Name: 사이 (Sai) — 글로벌 업무 메시지 AI 교정 크롬 확장
- Stack: React 18 + JavaScript(ES6+) + Vite 5 + @crxjs/vite-plugin / Firebase (Auth·Firestore·Functions, Node 22) / OpenAI API (단일 통합 호출 `POST /v1/refine`)
- 기간: 2026-08-12 ~ 08-21 (컷 규칙은 `docs/Tasks.md` 상단)

## Verified Commands
첫 성공 후 원문 그대로 기록. 변형 금지(필요 시 무엇을 왜 바꾸는지 먼저 한 줄).

| Purpose | Command | Verified on |
|---|---|---|
| 설치 | `npm install` | 2026-08-12 |
| 빌드 | `npm run build` | 2026-08-12 |
| 빌드 결과 확인 | `npx vite preview --port 4173 --strictPort` | 2026-08-12 |
| 단위 테스트 | `npm test` | 2026-08-12 |
| 로컬 refine 프록시 | `npm run proxy` | 2026-08-13 |
| 프록시 상태 확인 | `curl http://127.0.0.1:8787/health` | 2026-08-13 |
| Firestore 규칙 배포 | `firebase deploy --only firestore:rules` | 2026-08-13 |
| refineV1 인증 확인 (무인증이 막히는지) | `curl -s -o /dev/null -w "%{http_code}" -X POST .../refineV1 -H "Content-Type: application/json" -d "{}"` → **401** | 2026-08-17 |
| 코어 → functions 동기화 | `node scripts/sync-core.mjs` | 2026-08-13 |
| Functions 배포 | `firebase deploy --only functions` (동시 다건 실패 시 `firebase deploy --only functions:<이름>`으로 개별 재시도) | 2026-08-13 |
| Functions 배포 — 분석 타임아웃 시 | `FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions` | 2026-08-14 |
| 배포 확인 | `curl https://asia-northeast3-sai-global-msg-2026.cloudfunctions.net/health` | 2026-08-13 |
| 수신 해독 실측(운영) | `curl -X POST .../refineV1 -d '{"mode":"decode","text":"...","sourceLanguage":"en","targetLanguage":"ko"}'` | 2026-08-13 |
| 대시보드 설치 | `npm --prefix dashboard install` | 2026-08-13 |
| 대시보드 빌드 | `npm --prefix dashboard run build` | 2026-08-13 |
| 대시보드 배포 | `firebase deploy --only hosting` | 2026-08-13 |
| 대시보드 배포 확인 | `curl https://sai-global-msg-2026.web.app/` | 2026-08-13 |
| 한글 포함 API 실측 | 본문을 UTF-8 파일로 저장 후 `curl --data-binary @body.json` (🔴 인라인 `-d '{"text":"한글"}'`은 Windows 셸에서 깨져 **모델 결함으로 오진하게 된다** — Lessons #13) | 2026-08-13 |

> 🔴 **`.env`는 git 워크트리마다 따로 있다** (untracked 파일은 공유되지 않는다). 워크트리에서
> 작업하면 그 워크트리 루트에 `.env`가 있어야 `npm run proxy`·vite가 값을 읽는다.
| `/v1/refine` 실 API 20건 | `npm run test:refine:live` (키 필요, 없으면 exit 2) | 미실행 |

> 🔴 **2026-08-17 provider가 OpenAI(`gpt-4o`)로 바뀌었다** — 로컬 프록시·회귀 러너·배포본 셋 다
> 기본값이 openai다. Gemini는 `OPENAI_API_KEY`가 없을 때만 자동 선택된다(`--provider gemini`로 명시 가능).
> **셋의 기본값 순서는 항상 같아야 한다** — 하나만 바꾸면 "로컬에선 되는데 배포하면 다르다"가 시작된다.

> 🔴 **OpenAI 한도는 「하루 N건」이 아니라 「분당 토큰(TPM)」이다**(2026-08-17 실측, 헤더
> `x-ratelimit-*`): **TPM 10,000 · 요청 묶음 50(약 5시간마다 초기화)**. 교정 1건이 약 1,800토큰이라
> **연달아 6건을 부르면 4번째부터 429**가 난다(실측). 우리 코드는 429를 `quota` 폴백으로 분류하고
> **재시도하지 않으므로**, 화면에 「교정하지 못했어요」가 뜬다. **시연·회귀는 건당 15초 간격**을 둔다.
> 남은 양 확인:
> ```
> curl -s -D - -o /dev/null https://api.openai.com/v1/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY" ...
> ```
> (`x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`)

> 🔴 **Gemini 무료 티어는 모델당 하루 20건**(2026-08-13 429 실측). 대체 provider로 쓸 때 유효하다.

> 🟢 **한도에 걸리면 자동으로 예비 provider로 한 번 더 부른다**(2026-08-19 도입). 조건이 좁다 —
> **① 사유가 `quota`일 때만**(네트워크·형식 오류는 넘기지 않는다) **② 요청이 provider를 명시하지
> 않았을 때만** **③ 한 번만**. 어느 쪽이 답했는지는 응답 `providerUsed`와 서버 로그에 남는다.
> 프록시·Functions **양쪽에 같은 규칙**이 있고 `test/failover.unit.test.js`가 그걸 잠근다.
>
> 🟢 **시연 촬영용 캐시 수명**: `.env`에 `SAI_CACHE_TTL_MS=14400000`(4시간)을 넣으면 같은 문장
> 재호출이 그동안 **API를 쓰지 않는다**(기본 10분 · 상한 6시간 · 프로세스 메모리 전용).
> 부팅 로그로 확인한다 — `캐시 수명=240분` / `예비 provider=gemini`:
> ```
> SAI_PROXY_PORT=8803 SAI_CACHE_TTL_MS=14400000 npm run proxy
> ```
> 🔴 **Cloud Functions에서는 덜 듣는다** — 인스턴스가 여러 개 뜨고 수시로 내려가서 캐시가
> 그 인스턴스에 걸린 요청에만 맞는다. 촬영 중 호출을 확실히 줄이려면 로컬 프록시를 쓴다.

> 🔴 **`firebase functions:secrets:set`의 숨김 프롬프트에 붙여넣기가 조용히 실패한다**(2026-08-17 실측 —
> `Secret Payload cannot be empty`). 값을 파일로 넘긴다. 끝 개행이 섞이면 **401을 받고 코드 문제로
> 오진하게 된다**:
> ```
> $k = ((Get-Content .env | Where-Object { $_ -match '^OPENAI_API_KEY=' }) -split '=',2)[1].Trim()
> $tmp = Join-Path $env:TEMP 'oa.key'; [IO.File]::WriteAllText($tmp, $k, (New-Object System.Text.UTF8Encoding $false))
> firebase functions:secrets:set OPENAI_API_KEY --data-file $tmp; Remove-Item $tmp -Force
> ```

> 🔴 **프록시를 새로 띄우기 전에 그 포트가 비었는지 확인한다**(2026-08-17 실측). 이전 세션의 프록시가
> 남아 있으면 새 프로세스는 `EADDRINUSE`로 **뜨지도 못하는데**, curl은 **옛 코드를 돌리는 좀비 프록시**에
> 닿아 정상 응답을 준다 — 바꾼 코드가 반영 안 됐다고 오진하기 딱 좋다. 확인:
> ```
> Get-NetTCPConnection -State Listen -LocalPort (8787..8810) | Select LocalPort,OwningProcess
> ```

> 🔴 **배포가 `User code failed to load. Cannot determine backend specification. Timeout after 10000`으로
> 죽으면 코드 문제가 아닐 수 있다**(2026-08-14 실측). firebase-tools가 함수 목록을 뽑으려고 코드를
> 로드하는 단계의 **10초 제한**이며, Windows에서 콜드 스타트가 이보다 느리면 그냥 걸린다.
> **먼저 코드가 진짜 깨졌는지 분리해서 확인한다** — 아래 둘이 통과하면 코드는 정상이므로
> 타임아웃만 늘려 재시도한다(전면 재작성·롤백으로 가지 않는다):
> ```
> node --check functions/core/refine/prompt.js
> node -e "import('./index.js').then(()=>console.log('LOAD OK'))"   # functions/ 안에서
> ```

> 🔴 **새 Functions를 추가하면 `invoker: 'public'`을 명시한다**(2026-08-15 실측). 2세대 함수는
> 기본이 「인증된 호출자만」이고 **Firebase ID 토큰은 Cloud IAM 신원이 아니다** — 로그인한
> 사용자여도 IAM 단계에서 먼저 잘린다. 증상은 **구글이 낸 HTML 403/401**(우리 JSON이 아니다):
> ```
> <html><head><title>403 Forbidden</title>… Your client does not have permission
> ```
> `refineV1`은 이 옵션 없이도 되는데 먼저 만들어질 때 권한을 받았기 때문이다 — **새 함수는 못 받는다.**
> 「공개」는 HTTP로 닿을 수 있다는 뜻일 뿐이고, 실제 권한 판정은 핸들러 안의 토큰 검증이 한다.

> 🔴 **`functions/`에 의존성을 추가하면 peer 범위를 확인한다**(2026-08-15 실측). `npm install
> firebase-admin`이 최신 `14.x`를 넣었는데 `firebase-functions@6`은 `^11||^12||^13`만 받는다.
> **로컬 npm은 경고만 하고 넘어가지만 Cloud Build는 ERESOLVE로 배포를 죽인다.** 설치 후 확인:
> ```
> npm ls firebase-admin
> ```
> `invalid: … from node_modules/firebase-functions`가 보이면 그 버전으로는 배포되지 않는다.

> 🔴 **로컬 프록시는 재시작해야 코드 변경이 반영된다**(2026-08-14 실측). Node는 import 시점에
> 모듈을 고정하므로 `npm run proxy`를 띄워 둔 채 `src/core/**`를 고치면 **옛 코드가 계속 응답한다.**
> 프롬프트를 고치고 "모델이 말을 안 듣는다"고 오진하기 딱 좋다(Lessons #13 계열). 확인:
> 코드 수정 후 실측하기 전에 프록시를 내렸다 올린다. 남의 프록시를 죽이지 않으려면
> `SAI_PROXY_PORT=8799 npm run proxy`로 다른 포트에 새로 띄운다.

## Report Template
```
### 결론: {한 줄 — 됐는가/안 됐는가/얼마나}
| 항목 | 결과 | 이전/기준값 | 근거 (파일:줄, 로그, 수치) |
### 문제/다음 단계: {있으면}
```

## Environment Variables
- 새 환경 변수 도입 시 `.env.example`과 README 설정 표를 동시에 갱신.
- 필요한 변수가 없으면 추측·플레이스홀더 비밀값 생성 대신 사용자에게 요청.
