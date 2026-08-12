# 사이 (Sai)

사람과 사람, 언어와 언어 사이를 매끄럽게 잇는 글로벌 업무 메시지 AI 교정 도구 (크롬 확장 + 웹 대시보드).

- 마스터 명세: [docs/Spec.md](docs/Spec.md)
- 태스크 보드: [docs/Tasks.md](docs/Tasks.md)
- 이전 프로젝트 이식 지식: [docs/reference/Lessons.md](docs/reference/Lessons.md)

## Quick Start

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
| `OPENAI_API_KEY` | Functions 환경 | OpenAI API 키. **서버 전용 — 클라이언트 번들 포함 금지** |
| `VITE_FIREBASE_*` | `.env` | Firebase 웹 앱 구성값 (콘솔 > 프로젝트 설정) |

## 팀 (4인)

| 역할 | 담당 |
|---|---|
| [DS] 디자이너 | 디자인 시스템(주황/초록), Figma 시안, 아이콘 |
| [FE] 프론트엔드 | In-page 팝업, 사이드 패널 UI |
| [BE-A] 백엔드 A | OpenAI `POST /v1/refine` 파이프라인, 밈/공휴일 수집 |
| [BE-B] 백엔드 B | Firebase 세팅, 웹 대시보드, FE 멘토링 |
