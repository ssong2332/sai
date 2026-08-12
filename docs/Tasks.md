# Tasks — 사이 (Sai)

> 기준: `docs/Spec.md` (master). 충돌 시 Spec이 이긴다.
> Status 어휘: `todo` / `in-progress` / `review` / `done`. `done`은 실행 증거(테스트 출력·실브라우저 확인)가 있을 때만.
> 역할: [DS] 디자이너 · [FE] 프론트엔드 · [BE-A] 백엔드 A (AI 파이프라인) · [BE-B] 백엔드 B (Firebase·대시보드·멘토링)

## 컷 규칙

| 조건 | 행동 |
|---|---|
| 8/18(화) 저녁까지 P0(필수 11) 미완 항목 존재 | P1 착수 금지, 전원 P0 수렴 |
| 8/20(목) 정오까지 통합 데모 플로우 미동작 | 신규 기능 동결, 데모 경로 안정화만 |
| LLM 키 장애 | 폴백 데모 응답 경로로 시연 (S03에 내장) |

## P0 — 필수 기능 (전부 끝나야 제출 가능)

| ID | Task | 담당 | Depends | Spec | Status |
|---|---|---|---|---|---|
| S01 | **리포 스캐폴드** — Vite5+React18(JS)+@crxjs/vite-plugin, MV3 manifest(sidePanel·storage 권한), dist 언팩 로드 실브라우저 스모크(Lessons #1: jsdom 신뢰 금지, `process` define 처리) | BE-B | — | §6, §9 | todo |
| S02 | **Firebase 세팅** — 프로젝트 생성(콘솔은 사용자/팀), Auth(구글 로그인), Firestore, Functions 배포 파이프라인, `.env.example` 갱신 | BE-B | S01 | §6-2 | todo |
| S03 | **`POST /v1/refine` 단일 통합 호출** — OpenAI 1회 호출로 `refined`/`backTranslation`/`detectedIntent`/`ticket`/`appliedGlossary`/`urgency` 6필드 JSON 반환. 프롬프트는 `reference/c1·c2·c4·c6.ts` 통합. 실패 시 urgency=Normal+실패 알림 필드(필수 1), 크레딧 소진 폴백 응답+폴백 표시 필드(Lessons #5), 동일 입력 캐시+바이패스(Lessons #6). 통합 테스트는 `reference/TestCases-legacy.md`에서 20건 선별 | BE-A | S01 | §6-3, 필수 1·3·4 | todo |
| S04 | **[DS] Figma 시안** — In-page 팝업(작성/수신 모드)·사이드패널·대시보드, 주황/초록 토큰(`--primary-orange:#ff6b00`, `--primary-green:#10b981`), 아이콘 SVG | DS | — | §1, §7 | todo |
| S05 | **In-page 팝업: 작성 모드** — 드래그 선택(Selection API)→플로팅 버튼→교정 팝업. 긴급도 **사전 선택 세그먼트(Critical/Normal/Low/자동)**, 결과에 AI 판정+근거 표시·변경 가능(필수 1) | FE | S01, S03 | 필수 1, audit 1 | todo |
| S06 | **역번역 상시 노출 + 토글** — 교정문 바로 아래 역번역, ON/OFF 토글을 `chrome.storage.local`에 저장 | FE | S05 | 필수 3 | todo |
| S07 | **심리스 교체 + 클립보드 폴백** — 승인 시 원 입력창 직접 치환. contentEditable은 Range/insertText 방식(Lessons #2·#3), 실패 시 "클립보드에 자동 복사되었습니다 (Ctrl+V)" 토스트 | FE+BE-B | S05 | 필수 5 | todo |
| S08 | **Zero Retention 준수 구조** — 메시지 본문을 Functions 로그·Firestore 어디에도 저장하지 않는 코드 경로 확인(리뷰 체크리스트 항목화). 저장 허용: 카운트·메타데이터·diff **수치**만 | BE-A+BE-B | S03 | 필수 5, audit 7 | todo |
| S09 | **하소연→티켓 UI** — `detectedIntent`=하소연이면 "티켓 형태로 변환할까요?" 제안 → [문제점/영향/요청사항] 3단 + 우려 수준 메타 표시. 감정 신호 낮으면 미제안(오탐 방지, Lessons 자산 3) | FE | S05, S03 | 필수 4 | todo |
| S10 | **수신 메시지 해독기 (수신 모드)** — 드래그한 외국어 메시지를 직역/실제 의도/체감 긴급도/요구 행동 4축 해석 팝업. `/v1/refine`과 별도 모드 파라미터 | FE+BE-A | S05, S03 | 필수 10 | todo |
| S11 | **사이드패널 셸 + 3초 온보딩** — `chrome.sidePanel`, 탭 구조(온보딩·용어집·프로필·스니펫·학습내역·B2B 데모 배너), 최초 오픈 시 내 언어/주 협업 국가/기본 톤 3문항 | FE | S01, S04 | §1, 권장 9 | todo |
| S12 | **용어 사전** — 사이드패널 탭, 개인/팀/연동 3탭, `[원문 유지]` 태그, 우선순위 개인>팀>기본 AI, `/v1/refine`의 `appliedGlossary`와 연동 | FE+BE-B | S11, S03 | 필수 7 | todo |
| S13 | **프로필 우선순위 + Diff 학습** — 상황 템플릿(코드리뷰/장애 등)+개인 성향 1순위, Levenshtein diff 3회 이상만 반영(수치만 Firestore), 3회 미만이면 1순위 100%(과도기 규칙). 학습 내역 열람·개별 삭제(권장 11)까지 | BE-B | S02, S03 | 필수 2, audit 6 | todo |
| S14 | **퇴근 요정** — 상대 로컬 18:00~09:00이면 현지 아침 9시 예약 자동 제안. **Low 모드는 강제 예약(즉시 전송 차단)**. Nager.Date+Intl로 공휴일/주말 다음 영업일 연장. 업무시간 학습값 반영 | BE-A | S03, S13 | 필수 6, audit 5 | todo |
| S15 | **민감정보 가드** — LLM 전송 **전** 클라이언트 로컬 Regex(`sk-`, `ghp_`, 카드번호, 주민번호, 비밀번호 패턴) 감지 → 전송 차단 + `[REDACTED]` 마스킹 + 안내 | FE | S05 | 필수 11 | todo |
| S16 | **밈 수집 + Work-Safe Filter** — RSS 오픈 피드 기반 수집 Cloud Function(cron), 비속어/혐오 필터, 캐주얼 톤 옵션에 반영. 봇 차단 리스크 있으므로 **시드 데이터 동봉 후 크론은 보강** 순서로 | BE-A | S02, S03 | 필수 8, audit 4 | todo |
| S17 | **수신자 소통 가이드** — 서술형 태그("오전 응답 빠름" 등)만, 숫자 점수 전면 금지, 본인 열람·수정·비공개 권리. 수신자 수동 선택 드롭다운(audit 2 — Lessons #4에 따라 주 경로) 포함 | BE-B+FE | S11, S13 | 필수 9, audit 2 | todo |

## P1 — 데모 완성도 (P0 완료 후)

| ID | Task | 담당 | Spec | Status |
|---|---|---|---|---|
| S18 | B2B 웹 대시보드 — React, 목업 데이터로 Health Index(=100−마찰 카운트) 시각화 + v1 사이드패널 목업 배너. **EU AI Act 리스크: 발표에서 EU 전제 금지(Lessons #7)** | BE-B | §3 F-10/F-26 | todo |
| S19 | 이모지 자동 교체 안내 + 용어 초록 하이라이트 + 위험 표현 노란 밑줄 | FE | 권장 4·5·6 | todo |
| S20 | 스니펫 저장소 + 역번역 재생성 버튼 + 퇴근 요정 우회 경고 | FE | 권장 10·3·2 | todo |
| S21 | 스레드 직전 대화 5개 맥락 (2,000자 캡, "N개 참고함" 표시·끄기) | BE-A | 권장 8 | todo |
| S22 | GitHub OAuth 행동 데이터 연동 (리뷰/마감 → 소통 가이드 태그 보강) | BE-B | audit 3 | todo |
| S23 | 회의 시간 추천 + 양보 포인트 (토큰 이코노미 최소 구현) | BE-B+FE | 권장 12, §1 | todo |

## P2 — 부가 (여유 있을 때만)

| ID | Task | Spec |
|---|---|---|
| S24 | Undo 토스트(5초)·URGENT 태그·하소연 탭 뷰 | 부가 1·2·3 |
| S25 | 결정사항 자동 요약 (프롬프트 `reference/c7.ts` 재사용 — 저비용) | 부가 7 |
| S26 | 듀얼 시계·단축키·👍/👎 피드백 | 부가 8·9·5 |

## 마감 주간 (역할 무관 고정)

| ID | Task | 기간 | Status |
|---|---|---|---|
| S27 | 통합 테스트 — 데모 시나리오 전 구간 실브라우저 왕복 + 공개 URL curl 실측(Lessons #10) | 8/19~8/20 | todo |
| S28 | 시연 영상 15초/1분 촬영 | 8/20 | todo |
| S29 | 피치덱 + **8/21 최종 제출** | 8/20~8/21 | todo |
