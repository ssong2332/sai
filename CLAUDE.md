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
- 🔴 **상태: 해커톤(2026-08-12 ~ 08-21) 종료 후, 실제 서비스 출시를 목표로 계속 개발 중 (2026-09-30~, 1인 개발).** 결정·우선순위는 `docs/Spec.md` §0, 태스크는 `docs/Tasks.md` 「출시 v1.0」(L01~). 판단 기준은 「시연이 되는가」가 아니라 **「누구나·매일·안전하게 쓸 수 있는가」**.
- Stack: React 18 + JavaScript(ES6+) + Vite 5 + @crxjs/vite-plugin / Firebase (Auth·Firestore·Functions, Node 22) / **Anthropic Claude API** (`claude-haiku-5-5`, 사고 끔 · 단일 통합 호출 `POST /v1/refine`) — 2026-10-23 사용자 결정으로 기본, 폴오버 예비는 Groq(Spec §0). Gemini(2026-09-30~10-22 기본)·OpenAI는 명시 요청으로만 남는다. 아래 명령 절의 옛 provider 기록(2026-08-17 OpenAI, 10-01 Gemini)보다 이 줄이 우선한다
- 범위 밖(출시 v1.0): 캘린더 빈 시간(`calendar.readonly`) · 유료화. 팀 기능은 무료 공개
- 해커톤 기간 기록: 2026-08-12 ~ 08-21 (컷 규칙은 `docs/Tasks.md`의 「컷 규칙 (해커톤)」)

## Verified Commands
첫 성공 후 원문 그대로 기록. 변형 금지(필요 시 무엇을 왜 바꾸는지 먼저 한 줄).

| Purpose | Command | Verified on |
|---|---|---|
| 설치 | `npm install` | 2026-08-12 |
| 빌드 | `npm run build` | 2026-08-12 |
| 빌드 결과 확인 | `npx vite preview --port 4173 --strictPort` | 2026-08-12 |
| 사이트 개발 빌드(`externally_connectable`에 `http://localhost:5180/*` 추가) | `npm run build:sitedev` (🔴 같은 `dist/`에 쓴다 — 배포본은 반드시 `npm run build`로 다시 만든다) | 2026-10-24 |
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
| Functions 의존성 설치 (worktree에 `functions/node_modules`가 없을 때) | `functions/` 안에서 `npm ci` — 🔴 `npm --prefix functions install`은 쓰지 않는다: `functions/package.json`에 `"sai": "file:.."` 의존성을 몰래 추가한다(2026-10-23 실측) | 2026-10-23 |
| 대시보드 설치 | `npm --prefix dashboard install` | 2026-08-13 |
| 대시보드 빌드 | `npm --prefix dashboard run build` | 2026-08-13 |
| 대시보드 배포 | `firebase deploy --only hosting` | 2026-08-13 |
| 대시보드 배포 확인 | `curl https://sai-global-msg-2026.web.app/` | 2026-08-13 |
| 한글 포함 API 실측 | 본문을 UTF-8 파일로 저장 후 `curl --data-binary @body.json` (🔴 인라인 `-d '{"text":"한글"}'`은 Windows 셸에서 깨져 **모델 결함으로 오진하게 된다** — Lessons #13) | 2026-08-13 |
| Worker(L33) 설치 · 테스트 | `workers/refine/` 안에서 `npm ci` · `npm --prefix workers/refine test` — 🔴 `npm --prefix workers/refine install`은 쓰지 않는다: `package.json`에 `"sai": "file:../.."`를 몰래 넣는다(2026-10-23 하위 작업 2회 실측) (🔴 루트 `npm install`도 필요 — 코어가 루트의 `@anthropic-ai/sdk`를 쓴다. 🔴 2026-10-23부터 `test`는 `--import ./test/sdkAlias.mjs`로 배포본과 같은 SDK 대역을 탄다) | 2026-10-23 |
| Worker CPU 추정 | `npm --prefix workers/refine run bench:cpu` (Node 추정치 — 실제 cpuTime은 배포 후 Cloudflare) | 2026-10-23 |
| Worker 번들 확인(배포 안 함·로그인 불필요) | `npm --prefix workers/refine run build:dry` | 2026-10-23 |
| Worker 번들에 SDK 없음 확인(build:dry 포함) | `npm --prefix workers/refine run check:bundle` (🔴 `wrangler.toml` `[alias]`가 SDK를 `src/anthropicFetch.js`로 바꾼다 — 기준 112.8 KiB) | 2026-10-23 |
| Worker 콜드 CPU 추정(배포 번들 그대로·새 프로세스) | `npm --prefix workers/refine run bench:cold -- --runs 31` (먼저 build:dry. 🔴 run 수가 적으면 흔들린다 — 5회 11~17ms. Node 추정 — 실제는 배포 후 `wrangler tail` cpuTime) | 2026-10-23 |
| 디자인 하네스(콘텐츠 팝업 목업 렌더·스크린샷, 개발 전용 — 🔴 실브라우저 unpacked 확인을 대신하지 않는다) | `npm --prefix design-harness run dev` → `http://127.0.0.1:5199/` (`?theme=dark` · `?scene=<id>` · `?v=1` 이전 시안 비교. 첫 기동 ~40초. 루트 `npm install` 필요) | 2026-10-24 |
| 디자인 하네스 — 사이드패널·결정 화면(가짜 `chrome.*` 목업 저장소, 네트워크 차단) | 같은 서버에서 `http://127.0.0.1:5199/sidepanel.html` · `/decisions.html` (`?theme=dark`, 사이드패널 `?onboarding=new`). 창 폭 ~400px로 본다 | 2026-10-24 |
| Worker 로컬 workerd(가짜 키·가짜 Claude, 🔴 배포 금지 설정) | `npm --prefix workers/refine run dev:mock` → `http://127.0.0.1:8790` (`/__dev/token`으로 시험 토큰) | 2026-10-23 |
| 소개·설정 웹사이트(`site/`) 설치 | `site/` 안에서 `npm install` — 🔴 `npm --prefix site install`은 쓰지 않는다: `site/package.json`에 `"sai": "file:.."`를 몰래 넣는다(2026-10-24 실측) | 2026-10-24 |
| 웹사이트 빌드 | `npm --prefix site run build` | 2026-10-24 |
| 웹사이트 브리지 단위 테스트 | `npm --prefix site test` | 2026-10-24 |
| 웹사이트 dev 서버 | `npm --prefix site run dev` → `http://localhost:5180` (strictPort — 확장 externally_connectable 개발 매치가 이 포트) · 미리보기 `/settings?demo=1` | 2026-10-24 |
| Worker 배포 (🔴 사용자가 실행 — 에이전트 배포는 막혀 있다) | `workers/refine/` 안에서 `npx wrangler deploy` | 2026-10-24 |
| Worker 배포 확인 | `curl https://sai-refine.aiisgod.workers.dev/health` → `"thinking":"disabled"` | 2026-10-24 |
| Worker 실제 cpuTime 수집 (🔴 원본에 로그인 토큰이 있다 — 반드시 숫자만 거르는 필터를 거친다) | `workers/refine/` 안에서 `npx wrangler tail --format json 2>/dev/null \| node <필터.mjs>` — 필터는 path·method·status·outcome·cpuTime·wallTime만 출력, 원문은 버린다 | 2026-10-24 |

> 🔴 **`.env`는 git 워크트리마다 따로 있다** (untracked 파일은 공유되지 않는다). 워크트리에서
> 작업하면 그 워크트리 루트에 `.env`가 있어야 `npm run proxy`·vite가 값을 읽는다.
| `/v1/refine` 실 API 20건 | `npm run test:refine:live` (키 필요, 없으면 exit 2) | 미실행 |
| `/v1/refine` 실 API 20건 — Claude(시험) | `ANTHROPIC_API_KEY=... node scripts/refine-live.js --provider anthropic` → 21/21 통과·폴백 0 (응답 2.6~10.0초) | 2026-10-23 |

> 🔴 **2026-10-23 — 기본 provider는 Claude(anthropic)이고 예비는 groq뿐이다** (사용자 결정, Spec §0).
> 로컬 프록시·회귀 러너·Functions·Worker 넷 다 `failover.js` `pickDefaultProvider` **한 함수**로 고른다 —
> `ANTHROPIC_API_KEY`가 있으면 anthropic, 없으면 `GROQ_API_KEY`의 groq, 둘 다 없으면 **사슬 밖으로 내려가지 않는다**
> (gemini·openai는 `--provider`/`provider`로 명시할 때만). 폴오버 사슬은 anthropic → groq.
> 🔴 **예외 하나 — 운영 Functions**: ANTHROPIC·GROQ 시크릿이 Secret Manager에 **미등록**이라 등록 전에는
> `INTERIM_DEFAULT_PROVIDER`(gemini)로 돈다(배포 즉시 전면 500을 막으려는 임시 조치 — `functions/index.js` 표).
> 시크릿 등록 + 주석 해제 + 배포 후 이 예외를 지운다. 🔴 미등록 시크릿을 `defineSecret`하면 배포가 죽는다(아래 08-14·08-17 기록).
> 이력: 2026-10-01 L03 gemini → openai → openai/gpt-4.1 · 2026-08-17~09-30 openai 먼저.
> 확장은 provider를 요청에 싣지 않는다 — 실으면 폴오버가 꺼진다.
> **셋의 기본값 순서는 항상 같아야 한다**(지금은 넷) — 하나만 바꾸면 "로컬에선 되는데 배포하면 다르다"가 시작된다.
> `test/providerDefaults.unit.test.js`가 잠근다.
> 🔴 Claude 사고(thinking)는 **기본 끔**(L30 — 건당 $0.00070·2.4초 vs 켬 $0.00107·6.2초). 실험으로 켤 때만
> `SAI_ANTHROPIC_THINKING=adaptive`(그 밖의 값·없음은 전부 끔).

> 🔴 **OpenAI 한도는 「하루 N건」이 아니라 「분당 토큰(TPM)」이다**(2026-08-17 실측, 헤더
> `x-ratelimit-*`): **TPM 10,000 · 요청 묶음 50(약 5시간마다 초기화)**. 교정 1건이 약 1,800토큰이라
> **연달아 6건을 부르면 4번째부터 429**가 난다(실측). 우리 코드는 429를 `quota` 폴백으로 분류하고
> **재시도하지 않으므로**, 화면에 「교정하지 못했어요」가 뜬다. **시연·회귀는 건당 15초 간격**을 둔다.
> 남은 양 확인:
> ```
> curl -s -D - -o /dev/null https://api.openai.com/v1/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY" ...
> ```
> (`x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`)

> 🔴 **Gemini 무료 티어는 모델당 하루 20건**(2026-08-13 429 실측). 명시 요청·Functions 임시 기본으로 쓸 때 유효하다.

> 🟢 **한도에 걸리면 자동으로 예비 provider로 한 번 더 부른다**(2026-08-19 도입). 조건이 좁다 —
> **① 사유가 `quota` 또는 `auth`(키 무효, 2026-10-12 L15 추가)일 때만**(네트워크·형식 오류는 넘기지 않는다).
> 판정은 `src/core/refine/failover.js` `shouldFailOver` 한 곳 — 서버가 사유 문자열을 직접 비교하지 않는다 **② 요청이 provider를 명시하지
> 않았을 때만** **③ 한 번만**. 어느 쪽이 답했는지는 응답 `providerUsed`와 서버 로그에 남는다.
> 프록시·Functions·Worker(2026-10-23) **세 곳에 같은 규칙**이 있고 `test/failover.unit.test.js`가 그걸 잠근다.
> (③은 2026-08-20부터 「사슬 끝까지, 키 없는 단계는 건너뜀」이다.)
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

## 버전 규칙 (2026-10-23 사용자 승인)
- **확장 동작이 바뀌는 PR마다 버전을 올린다** — `package.json`과 `src/manifest.js` 두 곳을 같은 값으로(`test/version.unit.test.js`가 잠근다). 크롬 확장 카드의 숫자로 「다시 로드」가 반영됐는지 확인하기 위해서다. 문서·서버(Functions)만 바뀐 PR은 올리지 않는다.

## Report Template
```
### 결론: {한 줄 — 됐는가/안 됐는가/얼마나}
| 항목 | 결과 | 이전/기준값 | 근거 (파일:줄, 로그, 수치) |
### 문제/다음 단계: {있으면}
```

## Environment Variables
- 새 환경 변수 도입 시 `.env.example`과 README 설정 표를 동시에 갱신.
- 필요한 변수가 없으면 추측·플레이스홀더 비밀값 생성 대신 사용자에게 요청.
