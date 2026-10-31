# 결제 연동 설계 — Paddle (2026-10-31)

> 사용자 결정(2026-10-31): 유료화 전환 후 스토어 공개 · 결제 대행 Paddle(개인 판매자 가입 완료) · 요금제별 모드(Spec §0) · 「개인 Pro 먼저, 팀은 2단계」.
> 지금 단계: **샌드박스** 연동. 실판매는 Paddle 도메인 승인 + 사용자 승인 뒤.

## 금지 (다른 모든 것보다 우선)
- 🔴 API 키·웹훅 비밀값은 Worker 시크릿에만(`wrangler secret put`). 소스·문서·커밋·채팅·로그에 쓰지 않는다.
- 🔴 웹훅은 **서명 검증을 통과한 것만** 처리한다. 검증 실패는 401, 아무것도 쓰지 않는다.
- 🔴 결제 수단 정보(카드 등)는 받지도 저장하지도 않는다. 저장은 요금제·상태·기간·Paddle 식별자뿐. 메시지 본문과 무관(Spec 필수 5).
- 🔴 `BILLING_ENFORCED`가 켜지기 전에는 무료 사용자 한도가 지금(하루 100 · 기본 10 · 심층 3)과 같아야 한다 — 연동을 배포해도 아무도 덜 쓰게 되지 않는다.
- 🔴 실판매 전환(`PADDLE_ENV=live`·`BILLING_ENFORCED=1`)은 사용자 승인 건.

## 1. 흐름
| 단계 | 누가 | 무엇 |
|---|---|---|
| ① 결제 시작 | 확장 → Worker `POST /v1/billing/checkout` `{plan:'pro', interval:'month'|'year'}` | Firebase 토큰 확인 → Paddle API `POST /transactions`(가격 ID는 Worker 설정, `custom_data:{uid}`) → `{checkoutUrl}` |
| ② 결제창 | 사용자 브라우저 → 소개 사이트 `/checkout?_ptxn=txn_…` | Paddle.js(클라이언트 토큰)가 그 거래를 연다. 「기본 결제 링크」= 이 페이지 |
| ③ 결과 | Paddle → Worker `POST /v1/billing/webhook` | `Paddle-Signature` 검증 → `subscription.*` 이벤트의 `custom_data.uid`로 Firestore `billing/{uid}` 갱신(이벤트 시각이 더 오래되면 무시) |
| ④ 한도 | Worker `admit` | `billing/{uid}` 읽기 → 요금제 판정 → 그 요금제 한도 표 |

## 2. 요금제 판정표
| 조건 | 요금제 |
|---|---|
| `billing/{uid}.status` ∈ {`active`, `trialing`, `past_due`} 이고 가격 ID가 Pro | `pro` |
| 그 밖(문서 없음 · `canceled` · `paused` · 모르는 값) | `BILLING_ENFORCED` 켜짐 → `free` / 꺼짐 → `beta` |

| 요금제 | 하루 전체 | 기본 | 심층 | 상위 모드 없으면 |
|---|---|---|---|---|
| `beta`(유료 출시 전 무료) | 100 | 10 | 3 | — |
| `free` | 20 | 0 | 0 | 빠른으로, 사유 `plan` |
| `pro` | 200 | 10 | 3 | 빠른으로, 사유 `daily` |
| `team`(2단계) | 200 | 20 | 5 | 같음 |

이달 추정 $90 안전장치(`docs/QualityModes.md` 5절)는 요금제와 무관하게 먼저 적용한다.

## 3. Worker 설정
| 이름 | 종류 | 값 |
|---|---|---|
| `PADDLE_ENV` | var | `sandbox` · `live` — API 주소 `sandbox-api.paddle.com` / `api.paddle.com` |
| `PADDLE_PRICE_PRO_MONTH` · `PADDLE_PRICE_PRO_YEAR` | var | 가격 ID(비밀 아님) |
| `PADDLE_API_KEY` | 🔴 secret | 사용자가 넣는다 |
| `PADDLE_WEBHOOK_SECRET` | 🔴 secret | 사용자가 넣는다(웹훅 만든 뒤) |
| `BILLING_ENFORCED` | var | 없음 = 꺼짐. `1`일 때만 `free` 한도 |

설정이 빠지면 `/v1/billing/*`는 503 `{error:'billing-unavailable'}` — 지어낸 성공을 돌려주지 않는다. `/health`에 `billing: 'ready'|'unavailable'`(값은 싣지 않음).

## 4. 평가 기준 (구현 전 확정)
| # | 기준 | 판정 방법 |
|---|---|---|
| P1 | 서명이 맞는 웹훅만 처리 — 틀림·없음·5분 넘은 시각은 401, Firestore 쓰기 0 | 단위 테스트(실제 HMAC) |
| P2 | `subscription.created/updated/canceled`가 `billing/{uid}`를 판정표대로 바꾼다. 더 오래된 이벤트는 덮지 않는다 | 단위 테스트(가짜 Firestore) |
| P3 | 결제 시작은 로그인 필수(401), 모르는 요금제·주기는 400, 거래 생성 요청에 `custom_data.uid`·설정된 가격 ID가 실린다, 응답에 키 없음 | 단위 테스트(가짜 Paddle) |
| P4 | `admit`가 요금제별 한도를 쓴다 — `beta` 100/10/3 · `free` 20/0/0(사유 `plan`) · `pro` 200/10/3 | 단위 테스트 |
| P5 | `BILLING_ENFORCED` 꺼짐이면 기존 사용자 한도가 그대로(기존 Worker 테스트 전부 통과) | 테스트 |
| P6 | 로그·저장소·응답에 키·서명·카드 정보 없음, 로그에 uid 없음 | 단위 테스트 |
| P7 | 샌드박스 실결제: 테스트 카드로 Pro 결제 → 웹훅 → `billing/{uid}` 기록 | ✔ 2026-10-31 — 아래 6절 |
| T | `npm test` · Worker 테스트 · `check:bundle` · `build` | 실행 |

## 6. P7 실측 (2026-10-31, 샌드박스, Worker `665c11c3`, 확장 0.1.61 시험 빌드 `FEATURES.billing=true`)
| 단계 | 결과 |
|---|---|
| 확장 설정 「요금제」 → 「Pro 월 결제」 | ✔ 새 탭 `/checkout?_ptxn=…`에 Paddle 결제창(Test Mode) — 「지금 US$6.00 부가가치세 포함」(소계 $5.45 + 부가세 $0.55) |
| 테스트 카드 4242… 결제 | ✔ 「결제가 성공적으로 진행되었습니다」 → 우리 페이지 「결제가 끝났어요」, 샌드박스 영수증 PDF 수신 |
| 웹훅 1·2차 | ✘ 401 `bad signature` — Worker 시크릿이 다른 값(원인: `Get-Clipboard` 실행 때 클립보드에 비밀값이 아닌 명령어가 있었다) |
| 시크릿 재등록 후 Resend | ✔ 200, Worker 로그 `[billing] subscription.created → saved` |
| Firestore `billing/{uid}` | ✔ `status:"active"` · `priceId: pri_01m691c650…`(월) · `interval:"month"` · `periodEnd: 2026-11-30` · 구독·고객 식별자 · 카드·이메일 없음 |

알게 된 것: ① 한국 구매자는 **부가세 포함 가격**으로 표시된다 — $6 중 실수령은 부가세·수수료 뒤 약 $4.68(추정). 부가세 별도로 바꿀지는 실판매 전 결정 ② 서명 허용 오차는 Paddle 기본 5초, 우리는 300초(재전송 시각 차 대비) ③ 웹훅 비밀값은 「명령어 먼저 붙이기 → 비밀값 복사 → Enter」 순서로(CLAUDE.md Verified Commands).

## 7. 계정 삭제·보관 (2026-11-01 사용자 결정)
| 항목 | 결정 | 구현 |
|---|---|---|
| 부가세 | 포함 가격 유지($6·$48이 최종 금액) | 변경 없음 |
| 구독 중 계정 삭제 | 막고 「먼저 Paddle에서 해지」 안내(409 `subscription-active`) — 해지 예약(`cancelScheduled`)이면 허용 | `functions/account.js` · 웹훅이 `scheduled_change` 기록 |
| 결제 기록 보관 | 구독 끝(또는 계정 삭제) 중 늦은 날 + **5년**, 계정 삭제해도 남김 | `retainBilling` → `expireAt` · 🔴 **Firestore TTL 정책(`billing` 컬렉션 `expireAt`)은 사용자가 콘솔에서 켠다** — 안 켜면 자동 파기가 안 된다 |
| 팀 요금제 | 팀까지 만들고 공개 출시 | 설계 다음 |
## 8. 팀 요금제 설계 (2026-11-01 사용자 결정 「팀까지 만들고 출시」)
| 항목 | 결정 |
|---|---|
| 좌석 | 팀장이 N석 구매(**최소 2석**, 구매 때 현재 팀원 수 이상), 들어온 순서대로 배정. 팀원이 늘어도 자동 추가 청구 없음 — 좌석은 팀장이 늘린다 |
| 좌석이 꽉 참 | 초대 코드 참가 **차단**(409 `team-full`, 「팀장에게 좌석 추가를 요청해 주세요」) |
| 무료 팀 | 유료 출시(`BILLING_ENFORCED`) 뒤에는 **없음** — 팀 만들기·참가에 팀 요금제 필요(Spec §0 기능 범위 「팀 = Pro + 팀 용어집·대시보드·팀원 관리」) |
| 베타 때 만든 팀 | 유료 출시 후 **30일 유예** → 미구매면 팀 기능 잠금. 데이터는 보존, 구매하면 다시 열림 |
| 팀 기본 품질 모드 | 팀장이 정함 → 품질 설정을 한 번도 안 바꾼 팀원에게만(팀원이 고르면 팀원 것) |
| 좌석 축소(Paddle에서 팀원 수보다 적게) | 먼저 들어온 순서대로 좌석, 나머지는 무료 한도(팀 기능 잠금은 아님 — 팀은 결제 중) |
| 개인 Pro와 겹침 | 더 넉넉한 쪽(팀 200·기본 20·심층 5) |

### 8-1. 흐름
| 단계 | 내용 |
|---|---|
| 구매 | 확장 팀 관리 「팀 요금제 구매」(좌석 수) → `POST /v1/billing/checkout {plan:'team', interval, seats, teamId}` → Worker가 **팀장 확인**·좌석 ≥ max(2, 팀원 수) → Paddle 거래(`custom_data:{uid, teamId}`, 수량 = 좌석) |
| 기록 | 웹훅 → `teams/{teamId}`에 `billing:{status, priceId, seats, periodEnd, cancelScheduled}` |
| 좌석 판정 | 팀원 문서 `joinedAt` 순서 → 앞에서 N명 = 좌석. 요청마다 읽지 않도록 좌석 여부를 `billing/{uid}.teamSeat:{teamId}`에 써 둔다(웹훅·참가·나가기 때 갱신) |
| 참가 | `functions/teams.js` join — 결제된 팀이 좌석 꽉 참 → 409 `team-full` · 유료 출시 뒤 미결제 팀(유예 지남) → 409 `team-plan-required` |

### 8-2. 평가 기준 (구현 전 확정)
| # | 기준 |
|---|---|
| TP1 | 팀장이 아니면 팀 결제 시작 403 · 좌석 < max(2, 팀원 수)면 400 · 거래에 `teamId`·수량 |
| TP2 | 웹훅이 팀 구독을 팀 문서에 기록, 좌석 판정이 `joinedAt` 순서 |
| TP3 | 좌석 팀원 = 팀 한도(200·20·5), 좌석 밖 = 개인 요금제 |
| TP4 | 꽉 찬 결제 팀 참가 409 `team-full` · 유예 지난 미결제 팀 409 `team-plan-required` · `BILLING_ENFORCED` 꺼짐이면 지금 그대로 |
| TP5 | 팀 기본 모드는 품질 설정이 비어 있는 팀원에게만 |
| TP6 | 샌드박스 실결제(2석) → 웹훅 → 두 팀원 모두 팀 한도 |

### 8-3. 팀 기능 잠금 (2026-11-01 사용자 결정 「이 설계로」)
| 부분 | 내용 |
|---|---|
| 판정 | `functions/teams.js` `teamShouldLock` — 참가 판정의 「미결제(출시 뒤 생성 또는 유예 30일 끝)」와 같은 조건. 결제 팀·출시 전·출시 시각 모름은 잠그지 않는다 |
| 잠금 표시 | `teams/{teamId}.locked` — 매일 03:00(서울) Worker 예약 작업 `lockOverdueTeams`(바뀐 팀만 씀, 출시 전이면 잠긴 팀을 푼다). 결제 웹훅(유료 상태)은 바로 `false` |
| 규칙 | `firestore.rules` 팀 용어집 읽기·쓰기, 대시보드 지표 읽기에 `locked != true` — 🔴 진짜 방어선 |
| 확장 | `me.locked` → 팀 탭 「팀 요금제가 필요해요」, 다듬기에 팀 용어집 안 실음 |
| 데이터 | 지우지 않는다 — 구매하면 바로 풀림 |

## 5. 범위 밖 (이번 PR)
- 팀 요금제(좌석·팀원 연결) — 2단계
- 확장의 업그레이드 버튼·「무료 요금제는 빠른 모드만」 팝업 문구 — 결제 엔드포인트가 샌드박스에서 확인된 뒤
- 사이트 `/checkout` 페이지 — 다음 PR(클라이언트 토큰 사용)
- 처리방침에 「Paddle에 SAI 계정 식별자(uid) 전달」 추가 — 실판매 전 필수
