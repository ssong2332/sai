# S·AI

**Bridging People, Time, and Space**

한국어로 **「사이」**는 둘 사이의 간격, 그리고 그 간격이 만드는 관계를 뜻한다 — 두 사람 사이,
두 시간대 사이, **내가 의도한 것과 상대가 읽은 것 사이**. 그래서 이름을 `S·AI`로 썼다.

해외 협업 메시지를 **보내기 전에** 톤·긴급도·오해 소지를 잡아 주는 크롬 확장 + 웹 대시보드.

| 기둥 | 하는 일 |
|---|---|
| **Space** | 7개 언어(ko·en·zh·ja·de·fr·es) 교정 · 수신 메시지 뜻 풀기 · 역번역 · 원문 언어 자동 감지 |
| **Sync** | 듀얼 시계 · 회의 시간 추천 · 퇴근 시간대 예약 제안 |
| **Style** | 긴급도 3단 · 격식 3단(가볍게/기본/격식체) · **선호 말투 5종** · 용어집(개인·팀) · 오해 위험 표시 |

🔴 **메시지 본문을 서버·DB·로그에 저장하지 않는다** (Zero Retention). 올라가는 것은 정수
카운트뿐이고, [전용 테스트](test/zeroRetention.test.js)가 이를 강제한다.

## 지금 상태

| 항목 | 값 |
|---|---|
| 확장 버전 | **v0.1.44** (2026-10-27 — `package.json`과 `src/manifest.js`를 같은 값으로, 확장 동작이 바뀌는 PR마다 올린다) |
| 서버 | **Cloudflare Workers** `sai-refine.aiisgod.workers.dev` — 교정 `/v1/refine`·팀 `/v1/team` (확장 0.1.30~). Cloud Functions는 2026-10-28 삭제 — 서버는 Worker뿐 |
| 주 provider | Anthropic Claude `claude-haiku-5-5` (사고 끔, 2026-10-23 — Spec §0) · 프롬프트 `refine-v23` |
| 한도 폴오버 | **anthropic → groq** ([src/core/refine/failover.js](src/core/refine/failover.js)) — Gemini·OpenAI는 명시 요청만 |
| 단위 테스트 | 확장 1127건 · Worker 97건 |

🔴 **교정 품질을 고칠 때 «어느 쪽»을 배포해야 하는지 반드시 확인한다** (2026-08-20에 실제로
틀렸다 — 서버만 배포하고 「반영됐다」고 안내했는데 절반만 반영됐다).

| 무엇 | 어디에 있나 | 무엇을 배포해야 하나 |
|---|---|---|
| 프롬프트 «틀»(규칙 문장·조립 순서·`REFINE_PROMPT_VERSION`) | 서버 `src/core/refine/prompt.js` (Worker 번들에 들어감) | `workers/refine/` 안에서 `npx wrangler deploy` (사용자 실행) |
| **말투 힌트** `COLLAB_STYLES` | **확장** `src/lib/profile.js` | **새 릴리스(zip)** |
| **수신자 태그 힌트** `RECIPIENT_TAGS` | **확장** `src/lib/recipients.js` | **새 릴리스(zip)** |
| **상황 템플릿 힌트** `SITUATION_TEMPLATES` | **확장** `src/lib/profile.js` | **새 릴리스(zip)** |

확장이 `buildProfileForRefine()`으로 **힌트 «문자열»을 만들어 payload에 실어 보내고**, 서버는 받은
문자열을 그대로 쓴다. 그래서 힌트를 고치면 서버 배포로는 아무 일도 일어나지 않는다.

## 설치 (테스터용 — 개발 환경 불필요)

**[⬇ 최신 릴리스 다운로드](https://github.com/ssong2332/sai/releases/latest)**

직접 링크: [sai-extension.zip](https://github.com/ssong2332/sai/releases/latest/download/sai-extension.zip)

1. zip을 **옮기지 않을 자리**에 압축 해제 (나중에 옮기면 확장을 다시 로드해야 한다)
2. 크롬에서 `chrome://extensions` → 오른쪽 위 **개발자 모드** ON
3. **압축해제된 확장 프로그램을 로드합니다** → 압축을 푼 그 폴더 선택
   (`설치 안내.txt`가 보이는 폴더가 맞다)
4. 툴바의 S·AI 아이콘으로 사이드 패널을 열고 **구글 계정으로 로그인** — 이걸 해야 교정이 된다

자세한 사용법·알려진 제약은 zip 안의 **`설치 안내.txt`**에 있다.

> 릴리스 zip은 [GitHub Actions](.github/workflows/build.yml)가 만든다 — `npm test`(ESLint
> 게이트 포함)를 통과해야 빌드되고, `v*` 태그를 밀면 자동으로 첨부된다.
> 🔴 **태그를 밀 때 `src/manifest.js`의 `version`도 함께 올린다.** 크롬 확장 관리 화면에는
> 그 값이 뜨므로, 어긋나면 테스터가 어느 버전을 깔았는지 알 수 없다.

## 문서

- 마스터 명세: [docs/Spec.md](docs/Spec.md) — **모든 충돌의 최종 승자**
- 태스크 보드: [docs/Tasks.md](docs/Tasks.md) — 예약 항목(i18n·말투 검증)도 여기
- 이전 프로젝트 이식 지식: [docs/reference/Lessons.md](docs/reference/Lessons.md)
- 작업 규칙·검증된 명령: [CLAUDE.md](CLAUDE.md)

## Quick Start (개발자용)

```bash
npm install

# .env.example을 .env로 복사하고 값 채우기 (아래 Configuration)
# 🔴 .env는 git 워크트리마다 따로 있다 — 워크트리에서 작업하면 그 루트에 있어야 한다

npm run dev
# chrome://extensions → 개발자 모드 ON → 압축해제된 확장 프로그램을 로드합니다 → dist 폴더
# (JSX는 빌드해야 동작하므로 프로젝트 루트가 아닌 dist만 유효)
```

## Configuration

| 변수 | 위치 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | Secret Manager + 로컬 `.env` | 사슬 밖 — 명시 요청만(키 무효 2026-09-28~). 서버 전용, 클라이언트 번들 포함 금지 |
| `GEMINI_API_KEY` | Secret Manager + 로컬 `.env` | 사슬 밖(2026-10-23) — 명시 요청만. (옛 Functions의 임시 기본이었으나 2026-10-28 Functions 삭제로 쓰는 곳 없음) |
| `ANTHROPIC_API_KEY` | 로컬 `.env` + Worker 시크릿 (Functions Secret Manager는 🔴 미등록) | **기본 provider**(2026-10-23, Claude Haiku 5.5, 사고 끔 — `SAI_ANTHROPIC_THINKING=adaptive`로만 켬). 폴오버 1단계 |
| `GROQ_API_KEY` | 로컬 `.env` + Worker 시크릿 (Functions Secret Manager는 🔴 미등록) | **폴오버 예비**(2026-10-23, `openai/gpt-oss-120b`). 폴오버 2단계 |
| `SAI_SERVICE_ACCOUNT_FILE` | 실행하는 셸(또는 로컬 `.env`) — **키 파일 경로**, 키 파일은 저장소 밖 | Worker 주간 점검 `npm --prefix workers/refine run report`(2026-10-27, M2) — 최근 7일 `betaMetrics` + `/health`, 경고 있으면 종료 코드 1 |
| `VITE_FIREBASE_*` | `.env` | Firebase 웹 앱 구성값 (콘솔 > 프로젝트 설정) |
| `SAI_CACHE_TTL_MS` | 로컬 `.env` | 프록시 캐시 수명(기본 10분 · 상한 6시간). 시연 촬영 때 호출을 줄이는 용도 |
| `SAI_SITE_DEV` | 빌드 시점 — `npm run build:sitedev`가 켠다 (🔴 `.env`에서 읽지 않는다) | `1`이면 manifest `externally_connectable`에 `http://localhost:5180/*`가 붙고 설정에 「자세한 설정 — 웹에서 열기」가 뜬다(`docs/WebSplit.md` C). 🔴 이 빌드는 배포하지 않는다 |

> 🔴 **키를 시크릿에 등록할 때는 파일로 넘긴다.** `firebase functions:secrets:set`의 숨김
> 프롬프트에 붙여넣으면 조용히 빈 값이 들어가고, 끝 개행이 섞이면 401을 받고 **코드 문제로
> 오진하게 된다.** 절차는 [CLAUDE.md](CLAUDE.md)에 명령 원문으로 있다.

## 백엔드

확장은 LLM을 직접 부르지 않는다 — **API 키가 확장 번들에 들어가면 안 되기 때문**이다.
[src/config.js](src/config.js)의 `REFINE_ENDPOINT`가 백엔드 주소를 정한다.

### 프로덕션 (확장 0.1.30~)

```
https://sai-refine.aiisgod.workers.dev/v1/refine   # 교정·뜻 풀기·결정·회신
https://sai-refine.aiisgod.workers.dev/v1/team     # 팀·계정 삭제·지표
```

- `workers/refine/`는 공유 코어 `src/core/{refine,decode,decisions,reply}`를 **복사 없이 번들**하고,
  팀 판정은 `functions/teams.js`·`account.js`를 그대로 부른다(Firestore는 서비스 계정 REST — `wrangler.toml` `[alias]`).
- 🔴 **로그인하지 않으면 401이다.** Firebase ID 토큰을 `jose`로 검증한다. 하루 교정 상한도 서버가 센다.
- 🔴 **CORS는 확장 오리진만** 허용한다(다른 오리진 403).
- 배포: `workers/refine/` 안에서 `npx wrangler deploy` (🔴 사용자 실행) · 확인: `curl https://sai-refine.aiisgod.workers.dev/health`
- 옛 Cloud Functions(`refineV1`·`teamV1`·`health`)는 2026-10-28 삭제했다(Tasks L27). `firebase.json`에도 Functions 설정이 없다(#102). `functions/` 소스는 Worker가 판정 코드를 가져다 쓰므로 남아 있다.
  `functions/`의 팀·계정 코드는 Worker가 그대로 쓰므로 지우지 않는다.

### 한도 폴오버

| 순서 | provider · 모델 | 넘어가는 조건 |
|---|---|---|
| 1 | anthropic · `claude-haiku-5-5` | — |
| 2 | groq · `openai/gpt-oss-120b` | 1번이 `quota`·`auth` |

- 2026-10-23 변경(이전: 10-01 gemini → openai → openai/`gpt-4.1`). Gemini는 무료 티어 학습 사용 때문에 예비로도 두지 않는다(Spec §0).
- 🔴 **`quota`·`auth`(키 무효)일 때«만»** 넘긴다. 네트워크·형식 오류는 두 번 불러도 같은 이유로 실패한다. 키 없는 단계는 건너뛴다.
- 🔴 요청이 provider를 **명시**했으면 대체하지 않는다 — 어느 모델의 출력인지 모르는 채 품질을
  논하게 되기 때문이다.
- 표는 **한 파일에만** 있다([failover.js](src/core/refine/failover.js)). 프록시·Functions·Worker가
  같은 파일을 임포트하므로 어긋날 수 없다.
- 어느 쪽이 답했는지는 응답의 `providerUsed`·`modelUsed`에 남는다.

### 모니터링 (2026-10-27 결정 — M1 + M2, **보류**: 실사용자가 생기는 비공개 베타 시작 때 켠다 — Tasks L35)

> 🔴 지금은 정기 감시를 하지 않는다. M1은 베타 시작 때 등록하고, M2는 필요할 때만 실행한다.
> `/health`는 Firestore에 실제로 접속하지 않으므로 Firestore·Auth 장애는 M1으로 잡히지 않는다.

| 무엇을 잡나 | 방법 | 누가 |
|---|---|---|
| **멈춤** | 외부 가동 감시(UptimeRobot 등 무료)가 5분마다 `https://sai-refine.aiisgod.workers.dev/health`를 확인 → 실패 시 메일 | 👤 사용자(가입·등록) — **베타 시작 때** |
| **품질 저하** | 필요할 때(베타 이후 주 1회) `SAI_SERVICE_ACCOUNT_FILE=<키 경로> npm --prefix workers/refine run report` — 최근 7일 요청·실패율·응답 시간·사용자 + `/health`. 경고 판정표는 [reportCore.mjs](workers/refine/scripts/reportCore.mjs) | 실행하는 사람 |
| 실시간 원인 | `wrangler tail` + 숫자만 거르는 필터(CLAUDE.md) · Cloudflare 대시보드 관측 | 필요할 때 |

🔴 실사용자가 생기면 M3(Worker Cron으로 매일 자동 점검 + 메일)를 검토한다.

### 로컬 프록시 (오프라인 개발용)

```bash
npm run proxy                    # 기본 8787
SAI_PROXY_PORT=8799 npm run proxy   # 포트를 바꿔 남의 프록시를 죽이지 않는다
curl http://127.0.0.1:8787/health
```

- 🔴 **코드를 고치면 반드시 재시작한다.** Node는 import 시점에 모듈을 고정하므로, 띄워 둔 채
  `src/core/**`를 고치면 **옛 코드가 계속 응답한다** — 프롬프트를 고치고 "모델이 말을 안 듣는다"고
  오진하기 딱 좋다.
- 🔴 **새로 띄우기 전에 그 포트가 비었는지 확인한다.** 이전 세션의 프록시가 남아 있으면 새
  프로세스는 뜨지도 못하는데 curl은 **좀비 프록시**에 닿아 정상 응답을 준다.
- `server/refine-proxy.js`도 같은 `src/core/`를 실행하므로 동작이 프로덕션과 같다.

### 공통

- 백엔드가 죽어 있으면 확장은 **목업 응답으로 폴백**하며 화면에 "실제 교정 결과 아님"을 표시한다
  (Lessons #5 — 폴백을 실제 결과로 오인시키지 않는다).
- 🔴 **401·429는 목업으로 덮지 않는다.** 로그인만 하면 될 사람에게 그럴듯한 예시를 보여 주면
  **문제가 있다는 사실 자체가 숨는다.**

## Testing

```bash
npm test                                          # 단위 775건 (LLM은 스텁, 키 불필요)

# /v1/refine 실 API 통합 21건 — 키가 없으면 실행하지 않고 exit 2
npm run test:refine:live
npm run test:refine:live -- --provider gemini
npm run test:refine:live -- --model <모델명>
```

> ⚠️ 단위 테스트가 green이어도 **확장이 브라우저에서 동작한다는 근거가 되지 않는다**
> ([Lessons #1](docs/reference/Lessons.md)). 확장 기능은 unpacked 실브라우저 로드 확인이 있어야 done.

> 🔴 실 API 러너는 **1건이 요청 약 2건**을 쓴다. 무료 티어에서 21건 완주는 한도를 넘길 수 있으니
> provider별 잔여를 먼저 확인한다.

## 팀 (4인)

| 역할 | 담당 |
|---|---|
| [DS] 디자이너 | 디자인 시스템(주황/초록), Figma 시안, 아이콘 |
| [FE] 프론트엔드 | In-page 팝업, 사이드 패널 UI |
| [BE-A] 백엔드 A | OpenAI `POST /v1/refine` 파이프라인, 밈/공휴일 수집 |
| [BE-B] 백엔드 B | Firebase 세팅, 웹 대시보드, FE 멘토링 |
