# S·AI

**Bridging People, Time, and Space**

한국어로 **「사이」**는 둘 사이의 간격, 그리고 그 간격이 만드는 관계를 뜻한다 — 두 사람 사이,
두 시간대 사이, **내가 의도한 것과 상대가 읽은 것 사이**. 그래서 이름을 `S·AI`로 썼다.

해외 협업 메시지를 **보내기 전에** 톤·긴급도·오해 소지를 잡아 주는 크롬 확장 + 웹 대시보드.

| 기둥 | 하는 일 |
|---|---|
| **Space** | 7개 언어(ko·en·zh·ja·de·fr·es) 교정 · 수신 메시지 해독 · 역번역 |
| **Sync** | 듀얼 시계 · 회의 시간 추천 · 퇴근 시간대 예약 제안 |
| **Style** | 긴급도 3단 · 문체 3단(가볍게/기본/격식) · 용어집 · 오해 위험 표시 |

🔴 **메시지 본문을 서버·DB·로그에 저장하지 않는다** (Zero Retention). 올라가는 것은 정수
카운트뿐이고, [전용 테스트](test/zeroRetention.test.js)가 이를 강제한다.

## 설치 (테스터용 — 개발 환경 불필요)

**[⬇ 최신 릴리스 다운로드](https://github.com/ssong2332/sai/releases/latest)**

직접 링크: [sai-extension.zip](https://github.com/ssong2332/sai/releases/download/v0.1.0/sai-extension.zip) (v0.1.0)

1. zip을 **옮기지 않을 자리**에 압축 해제 (나중에 옮기면 확장을 다시 로드해야 한다)
2. 크롬에서 `chrome://extensions` → 오른쪽 위 **개발자 모드** ON
3. **압축해제된 확장 프로그램을 로드합니다** → `manifest.json`이 있는 그 폴더 선택
4. `Alt+S`로 사이드 패널을 열고 **구글 계정으로 로그인** (이걸 해야 교정이 된다)

자세한 사용법·알려진 제약은 zip 안의 **`설치 안내.txt`**에 있다.

> 릴리스 zip은 [GitHub Actions](.github/workflows/build.yml)가 만든다 — 테스트 754건을
> 통과해야 빌드되고, `v*` 태그를 밀면 자동으로 첨부된다.

## 문서

- 마스터 명세: [docs/Spec.md](docs/Spec.md)
- 태스크 보드: [docs/Tasks.md](docs/Tasks.md)
- 이전 프로젝트 이식 지식: [docs/reference/Lessons.md](docs/reference/Lessons.md)

## Quick Start (개발자용)

```bash
# 1. 패키지 설치
npm install

# 2. 환경 변수
#    .env.example을 .env로 복사하고 값 채우기 (표는 아래 Configuration 참조)

# 3. 크롬 확장 프로그램 개발 모드 실행
npm run dev

# 4. 크롬 브라우저 설정
#    chrome://extensions → '개발자 모드' ON → '압축해제된 확장 프로그램을 로드합니다' → dist 폴더 선택
#    (JSX는 빌드해야 동작하므로 프로젝트 루트가 아닌 dist만 유효)
```

## Configuration

| 변수 | 위치 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | Functions 환경 | OpenAI API 키 — **Spec §6-3 기준 provider**(배포·제출 경로). 서버 전용, 클라이언트 번들 포함 금지 |
| `GEMINI_API_KEY` | 로컬 `.env` | Gemini API 키 — **로컬 개발/테스트 전용 대체 provider**. 서버 전용 |
| `VITE_FIREBASE_*` | `.env` | Firebase 웹 앱 구성값 (콘솔 > 프로젝트 설정) |

> provider 선택: `refine()`의 `deps.provider`(`openai` | `gemini`). 생략하면 Spec 기준인 `openai`.
> 로컬 러너는 `GEMINI_API_KEY`가 있으면 gemini를 먼저 고른다 — **제출 판정은 openai 실행 결과로 한다.**

## 백엔드

확장은 LLM을 직접 부르지 않는다 — **API 키가 확장 번들에 들어가면 안 되기 때문**이다.
[src/config.js](src/config.js)의 `REFINE_ENDPOINT`가 백엔드 주소를 정한다.

### 프로덕션 (기본값, 2026-08-13 배포됨)

```
https://asia-northeast3-sai-global-msg-2026.cloudfunctions.net/refineV1
```

- `functions/index.js`는 `src/core/refine/`(→ `scripts/sync-core.mjs`가 배포 직전 `functions/core/`로
  복사)를 얇게 감싼 Cloud Functions 2세대다. 키는 Secret Manager(`GEMINI_API_KEY`)에만 있다.
- 코드를 고치면: `firebase deploy --only functions` (동시 다건 배포가 GCS 버킷 생성 경합으로
  간헐 실패하면 `firebase deploy --only functions:<이름>`으로 개별 재시도).
- 확인: `curl https://asia-northeast3-sai-global-msg-2026.cloudfunctions.net/health`
- 🔴 지금 CORS가 전체 허용이다 — 확장 ID가 정해지면 그 오리진으로 좁혀야 한다.

### 로컬 프록시 (오프라인 개발용)

```bash
# .env에 GEMINI_API_KEY(또는 OPENAI_API_KEY)를 넣고
npm run proxy

# 상태 확인
curl http://127.0.0.1:8787/health
```

`src/config.js`의 `REFINE_ENDPOINT`를 파일 안의 `LOCAL_PROXY_ENDPOINT` 값으로 바꾸면(그리고
`src/manifest.js`의 `host_permissions`에 `http://127.0.0.1:8787/*`를 추가하면) 이쪽을 쓴다.
`server/refine-proxy.js`도 같은 `src/core/refine/`를 그대로 실행하므로 동작이 프로덕션과 같다.

### 공통

- 백엔드가 죽어 있으면 확장은 **목업 응답으로 폴백**하며 화면에 "목업 응답 — 실제 교정 결과 아님"을
  표시한다 (Lessons #5 — 폴백을 실제 결과로 오인시키지 않는다).

## Testing

```bash
# 단위 테스트 (API 키 불필요 — LLM은 스텁)
npm test

# /v1/refine 실 API 통합 20건 (레거시 74건에서 선별)
#   키가 없으면 실행하지 않고 exit 2 — 미실행을 통과로 기록하지 않는다
npm run test:refine:live                          # GEMINI_API_KEY 있으면 gemini
npm run test:refine:live -- --provider openai     # Spec 기준 경로
npm run test:refine:live -- --model <모델명>      # 모델 교체
```

> ⚠️ 단위 테스트가 green이어도 **확장이 브라우저에서 동작한다는 근거가 되지 않는다**
> ([Lessons #1](docs/reference/Lessons.md)). 확장 기능은 unpacked 실브라우저 로드 확인이 있어야 done.

## 팀 (4인)

| 역할 | 담당 |
|---|---|
| [DS] 디자이너 | 디자인 시스템(주황/초록), Figma 시안, 아이콘 |
| [FE] 프론트엔드 | In-page 팝업, 사이드 패널 UI |
| [BE-A] 백엔드 A | OpenAI `POST /v1/refine` 파이프라인, 밈/공휴일 수집 |
| [BE-B] 백엔드 B | Firebase 세팅, 웹 대시보드, FE 멘토링 |
