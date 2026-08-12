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
| (아직 없음) | | |

## Report Template
```
### 결론: {한 줄 — 됐는가/안 됐는가/얼마나}
| 항목 | 결과 | 이전/기준값 | 근거 (파일:줄, 로그, 수치) |
### 문제/다음 단계: {있으면}
```

## Environment Variables
- 새 환경 변수 도입 시 `.env.example`과 README 설정 표를 동시에 갱신.
- 필요한 변수가 없으면 추측·플레이스홀더 비밀값 생성 대신 사용자에게 요청.
