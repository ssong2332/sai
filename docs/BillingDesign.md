# 결제 연동 설계 — Groble (2026-11-04, 이전 Paddle 2026-10-31)

> 🔴 **2026-11-04 사용자 결정 「groble로 가자」 — 결제 대행을 Paddle에서 Groble(groble.im)로 바꾼다.** 해외 카드 결제는 나중.
> 바뀌는 것은 **결제 시작·웹훅·결제창**(아래 0절)뿐이다. 요금제 판정표(2절)·팀 좌석 규칙(8절)·잠금(8-3)·배지(8-5)·계정 삭제·5년 보관(7절)은 그대로 쓴다.
> 1·3·6절과 8-4의 Paddle 고유 부분(`custom_data`·`sig`·`Paddle-Signature`·`/checkout?_ptxn`)은 **옛 기록**이다 — 0절이 이긴다.
> 지금 단계: **설계(이 문서)**. 구현은 0-7의 결정 뒤. 실판매는 사용자 승인 건.

## 0. Groble 전환 (2026-11-04)
근거: Groble 공식 가이드 `help/guides/webhook` · `webhook-events` · `payment-window` · `faq` (2026-11-04 읽음). 가이드에 없는 것은 「❓」로 둔다 — 추측으로 채우지 않는다.

### 0-1. Paddle과 다른 점
| 항목 | Paddle(옛) | Groble | 사이에 주는 영향 |
|---|---|---|---|
| 판매 형태 | 판매 대행(MoR) — 세금을 Paddle이 처리 | 통신판매중개 — **판매자(사용자)가 부가세·소득세 신고** | 🔴 세무는 사용자 몫. 수수료 세금계산서는 Groble(리에종 명의)이 발행 |
| 통화 | USD 등 | **원화(KRW) 정수만** | 가격을 원화로 새로 정한다(0-7 결정 1) |
| 결제 수단 | 카드(해외 포함) | 카드 · 카카오페이 · 네이버페이 | 해외 카드는 ❓ — 사용자 결정으로 나중 |
| 결제 시작 | Worker가 API로 거래 생성 | **상품 결제 링크 + `?ref=`** — 거래를 만드는 API 없음 | Worker는 링크만 만들어 준다 |
| 사용자 연결 | `custom_data:{uid}` + 서버 서명 `sig` | `?ref=`(1~128자, `A-Za-z0-9-_.:=~`)가 웹훅 `sellerReference`로 돌아온다 | 🔴 구매자가 바꿀 수 있는 값 → **추측할 수 없는 일회용 토큰**만 싣는다(0-3) |
| 구독 식별자 | `subscription.id` | **없음** — 회차마다 `merchantUid`가 바뀐다 | 구독 = `sellerReference`(토큰)로 묶는다 |
| 수량 | 거래 수량 = 좌석 | **정기결제는 수량이 항상 1** | 팀 좌석은 **인원별 옵션**(0-7 결정 2) — `options[0].optionId`로 좌석 수를 정한다 |
| 결제 주기 | 가격 ID마다 | `subscription.billingCycleMonths`(1~12, 시작 때 고정) | 월·연을 이 값으로 판정. 주기를 상품에서 정하는지 옵션에서 정하는지는 ❓ |
| 시험 환경 | 샌드박스 | **없음** — 웹훅 「테스트 발송」만, 가이드는 실제 결제 1건 권장 | 실결제 소액 시험 → 환불(0-6) |
| 플랜 변경 | `subscription.updated` | ❓ 가이드에 없음 | 좌석 변경 = 해지 후 새 옵션 결제로 가정(추정 — Groble 문의) |

### 0-2. 흐름
| 단계 | 누가 | 무엇 |
|---|---|---|
| ① 결제 시작 | 확장 → Worker `POST /v1/billing/checkout` `{plan, interval, seats?, teamId?}` (요청 모양은 지금 그대로) | Firebase 토큰 확인 · 팀이면 팀장·좌석 확인(TP1 그대로) · 이미 결제 중이면 409(C1 그대로) → 토큰 발급(0-3) → `{checkoutUrl: 'https://groble.im/payment/<상품 ID>?ref=<토큰>'}` |
| ② 결제창 | 사용자 브라우저 → Groble 결제 페이지 | 사이 사이트를 거치지 않는다. `site/src/pages/Checkout.jsx`(Paddle.js)는 쓰지 않게 된다 |
| ③ 결과 | Groble → Worker `POST /v1/billing/groble-webhook` | 서명 검증(0-4) → 이벤트 표(0-5)대로 `billing/{uid}` 또는 `teams/{teamId}.billing` 갱신 |
| ④ 한도 | Worker `admit` | 지금 그대로(`resolvePlan`) |

### 0-3. 결제 토큰 (`?ref=`) — B1(남의 계정에 결제 붙이기) 방어
| 항목 | 내용 |
|---|---|
| 모양 | `sr_` + 무작위 24바이트 base64url(32자) — 🔴 uid·teamId를 넣지 않는다(구매자가 바꿀 수 있고, Groble에 식별자를 넘기지 않는다) |
| 저장 | Firestore `billingRefs/{토큰}` = `{uid, teamId|null, plan, interval, seats, optionId, createdAt, boundAt|null}` — Worker(서비스 계정)만 읽고 쓴다, 규칙에서 클라이언트 접근 0 |
| 결제 시작마다 | 새 토큰. 결제하지 않은 토큰은 **24시간** 뒤 무효(웹훅이 와도 `unknown-ref`) — 0-7 결정 4 |
| 첫 웹훅(`INITIAL`) | 토큰이 있고 `payment.purchasedAt`이 `createdAt` + 24시간 안 · 옵션 ID가 토큰의 `optionId`와 같을 때만 → `boundAt` 기록. 이후 회차는 묶인 토큰이면 기간 제한 없음. 🔴 판정은 웹훅이 **도착한** 시각이 아니라 결제 시각으로 한다 — Groble 재시도가 최대 약 44시간 늦게 올 수 있다 |
| 바꾼 ref | 없는 토큰 → `unknown-ref`, 쓰기 0. 남의 토큰을 알아내려면 32자 무작위를 맞혀야 한다 |
| 다른 옵션 결제 | 토큰과 옵션이 다름(예: 2석 토큰으로 10석 결제) → `wrong-option`, 쓰기 0 + 로그(uid 없이) |
| 환불 연결 | 환불 이벤트에는 `sellerReference`가 없다 → 회차 웹훅마다 `billingRounds/{merchantUid}` = `{ref}`를 써 두고 환불 때 찾는다 |

### 0-4. 웹훅 검증·응답
| 조건 | 응답 | 쓰기 |
|---|---|---|
| `X-Groble-Signature`(또는 키 교체 뒤 24시간 `X-Groble-Signature-Previous`) ≠ HEX(HMAC-SHA256(비밀값, `{X-Groble-Timestamp}.{원문 본문}`)) · 헤더 없음 | 401 | 0 |
| 시각이 ±5분 밖 | 401 | 0 |
| 같은 `X-Groble-Idempotency-Key`를 이미 처리 | 200 | 0 |
| 모르는 이벤트 · `unknown-ref` · `wrong-option` | 200(재시도해도 같으므로) | 0 |
| Firestore 실패 | 503(Groble이 재시도 — 7회·약 44시간) | — |
| 정상 | 200, 10초 안 | 0-5 표 |
- 비교는 상수 시간(`safeEqual` 재사용). 처리한 키는 `billingEvents/{키}` `{at}`(30일 뒤 지움 — TTL은 7절처럼 Blaze 뒤, 그 전엔 남아도 본문 없음).
- 순서 보장 없음 → 이벤트 `occurredAt`이 저장된 것보다 오래되면 무시(지금 규칙 그대로).
- 🔴 웹훅 본문의 `buyer.email`·`buyer.phoneNumber`·`buyer.displayName`·`paymentMethod.*`·`questionAnswers[]`는 **읽지도 저장하지도 로그하지도 않는다**(금지 3).

### 0-5. 이벤트 → 상태 판정표
| 이벤트 | 조건 | 저장 상태 | 비고 |
|---|---|---|---|
| `subscription_payment.completed` | — | `active` · `periodEnd` = `subscription.nextBillingDate` · `cancelScheduled:false` · `interval` = `billingCycleMonths`(1=month, 12=year, 그 밖 → `wrong-option`) | 첫 회·갱신 같음 |
| `subscription_payment.failed` | `failure.isFinal:false` | `past_due`(Pro 유지 — 판정표 2절 그대로) | Groble 기본 재시도 1일 간격 3회 |
| `subscription_payment.failed` | `isFinal:true` | `past_due` · `graceEnd` = `failure.gracePeriodEndsAt` | 유예 7일, 끝나면 `terminated`가 온다 |
| `subscription.cancel_requested` | — | 상태 그대로 + `cancelScheduled:true` | 계정 삭제 허용 조건(7절)과 같은 의미 |
| `subscription.terminated` | — | `canceled` · `endedAt` = `termination.terminatedAt` · `expireAt` = +5년 | 팀이면 좌석 해제·잠금 판정(8-3) |
| `subscription_payment.refunded` | `billingRounds/{merchantUid}`로 토큰을 찾음 · 전체·부분 환불 같음 | **바로** `canceled` · `endedAt` = `refund.refundedAt` · `expireAt` = +5년 · 팀이면 좌석 해제·잠금 판정 | 0-7 결정 3. Groble 구독은 `ACTIVE`로 남을 수 있다 — 다음 회차 `completed`가 오면(다시 돈을 냈으므로) `active`로 돌아간다 |
| `payment.*`(단건) | — | 무시 | 사이는 정기결제만 판다 |
- 「해지 요청 철회」 이벤트는 Groble이 아직 보내지 않는다 → 철회해도 `cancelScheduled:true`가 남다가 다음 `completed`가 `false`로 되돌린다. 그동안 영향: 계정 삭제가 허용된 상태로 보임(삭제하려면 어차피 해지 안내).

### 0-6. Worker 설정 (Paddle 값 대신)
| 이름 | 종류 | 값 |
|---|---|---|
| `GROBLE_PRODUCT_PRO` · `GROBLE_PRODUCT_TEAM` | var | 상품 ID(결제 링크 경로, 비밀 아님) |
| `GROBLE_OPTIONS` | var(JSON) | 옵션 ID → `{plan, interval, seats}` 표 — 🔴 판정은 이 표 한 곳 |
| `GROBLE_WEBHOOK_SECRET` | 🔴 secret | 사용자가 넣는다(내 스토어 → 연동에서 한 번만 보임, 24시간에 한 번 재발급). 넣는 순서는 CLAUDE.md Paddle 시크릿 줄과 같다 |
| `BILLING_ENFORCED` | var | 그대로 |
- API 키는 필요 없다(Groble은 결제를 만드는 API가 없다). B1의 `sig`(API 키에서 만든 HMAC)는 0-3 토큰으로 바뀐다.
- 시험: 「테스트 발송」으로 서명·파싱 확인 → 사용자 계정으로 가장 싼 옵션 실결제 1건 → 웹훅 → `billing/{uid}` → Groble에서 환불 → `refunded`·`terminated` 확인.

### 0-7. 구현 전에 사용자가 정할 것
| # | 결정 | 제안 |
|---|---|---|
| 1 | 원화 가격 — Pro 월·연, 팀 1인 월·연 | ✔ **2026-11-04 사용자 결정**: Pro **월 ₩7,900 · 연 ₩59,000** · 팀 1인 **월 ₩13,900 · 연 ₩135,000**(좌석 옵션 = 1인 가격 × 좌석 수, 예: 2석 월 ₩27,800). 부가세 포함 최종 금액(7절과 같은 원칙). 한 달 실수령 추정(Groble 정기 수수료 5.4% + 그 부가세 · 판매 부가세 10% 뺌, 일반과세자 가정 — 🔴 과세 유형은 세무 확인): Pro 월 결제 ₩6,713 · 연 결제 월 ₩4,178 / 팀 1인 월 ₩11,811 · 연 결제 월 ₩9,559. 비교: 매일 한도까지 쓰는 Pro 1명 API 원가 월 약 ₩6,664($4.76 × 1,400원 — 환율 추정) |
| 2 | 팀 좌석 옵션 범위 | ✔ 2026-11-04 사용자 결정: **2~10석**, 옵션 18개(9단 × 월·연). 10석 넘는 팀은 문의 |
| 3 | 환불 시 처리 | ✔ 2026-11-04 사용자 결정: **환불 알림이 오면 바로 끈다**(부분 환불 포함) — 0-5 표 |
| 4 | 결제하지 않은 토큰 유효 기간 | ✔ 2026-11-04 사용자 결정: **24시간**(결제 시각 기준) — 0-3 표 |
| 5 | Paddle 코드·사이트 `/checkout` | 지우지 않고 꺼 둔다(🔴 삭제는 승인 건) — Groble 실결제 확인 뒤 지울지 다시 묻는다 |
| 6 | Groble 문의 2건 | 플랜(좌석) 변경 방법 · 주기를 옵션별로 둘 수 있는지 — 사용자가 문의 |

### 0-8. 같이 바꿔야 하는 곳 (구현 PR에서)
| 곳 | 바꿀 것 |
|---|---|
| `workers/refine/src/billing.js` | `verifyGrobleSignature` · 토큰 발급·검증 · 이벤트 판정표(0-5) — 판정표 2절·좌석·잠금 함수는 재사용 |
| `workers/refine/src/handler.js` | `/v1/billing/groble-webhook` 경로 |
| `functions/account.js` 안내 문구 | 「Paddle에서 해지」 → 「Groble 주문조회에서 해지」 |
| 처리방침·약관·환불 정책(`site/src/legal/*` · `dashboard/public/*`) | 결제 위탁처 Paddle → Groble, 판매자·환불 주체 — 🔴 실판매 전 필수, 법적 문구라 사용자 확인 |
| `firestore.rules` | `billingRefs`·`billingRounds`·`billingEvents` 클라이언트 접근 0 |
| 확장 | 결제 버튼이 받은 주소를 새 탭으로 여는 것은 그대로 — 변경 거의 없음(추정, 구현 때 확인) |

### 0-9. 평가 기준 (구현 전 확정)
| # | 기준 | 판정 방법 |
|---|---|---|
| G1 | 서명이 맞는 웹훅만 — 틀림·없음·±5분 밖은 401·쓰기 0, Previous 서명도 받음 | 단위 테스트(실제 HMAC) |
| G2 | 같은 멱등 키 두 번 → 두 번째 쓰기 0 · 오래된 `occurredAt`은 덮지 않음 | 단위 테스트 |
| G3 | 바꾼 ref(`unknown-ref`)·옵션 불일치(`wrong-option`)·만든 지 24시간 지나 결제된 토큰은 쓰기 0 · 결제는 24시간 안인데 웹훅이 늦게 온 것은 처리 | 단위 테스트 |
| G4 | 0-5 표의 이벤트 7줄이 표대로 상태를 바꾼다 · 환불은 `merchantUid`로 찾는다 | 단위 테스트(가짜 Firestore) |
| G5 | 팀 옵션 결제가 좌석 수를 옵션 표에서 정한다 — TP2~TP4 그대로 통과 | 기존 팀 테스트 + 새 테스트 |
| G6 | 저장·로그·응답에 구매자 이메일·전화·이름·카드·uid(로그) 없음 | 단위 테스트 |
| G7 | `BILLING_ENFORCED` 꺼짐이면 지금 한도 그대로 — 기존 Worker 테스트 전부 통과 | 테스트 |
| G8 | 실결제 1건 → 웹훅 → `billing/{uid}` → 환불 → 해지 반영 | 👤 사용자 결제 + Worker 로그(필터) |

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
| 결제 기록 보관 | 구독 끝(또는 계정 삭제) 중 늦은 날 + **5년**, 계정 삭제해도 남김 | `retainBilling` → `expireAt` · 🔴 **Firestore TTL 정책(`billing` 컬렉션 `expireAt`)은 아직 없다** — 2026-11-01 콘솔·CLI 둘 다 `403 billing disabled`(프로젝트가 Spark). 사용자 결정 「미루기」: **실판매 전환 때 Blaze 연결 후** `firestore.indexes.json` `fieldOverrides`에 `{collectionGroup:"billing", fieldPath:"expireAt", ttl:true, indexes:[]}`를 더해 `firebase deploy --only firestore:indexes`. 가장 이른 만료가 해지 +5년이라 그 전까지 지장 없음 |
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

### 8-4. 코드 검토 보강 (2026-11-01 「전부 고쳐」)
| # | 조건 | 처리 | 위치 |
|---|---|---|---|
| B1 | 웹훅 `custom_data`에 서버 서명(`sig`)이 없거나 틀림 | `unsigned` — 쓰기 0. 🔴 클라이언트 토큰은 공개라 누구나 결제창을 열어 남의 uid·teamId를 넣을 수 있었다. 키 = API 키에서 용도를 붙여 만든 HMAC(새 시크릿 없음) | `billing.js` `signCustomData` |
| B1 | 팀 이벤트인데 팀 가격이 아님 / 개인 이벤트인데 Pro 가격이 아님 | `wrong-price` — 쓰기 0 | `applySubscriptionEvent` |
| B2 | 혼자인 팀장이 결제 중(해지 예약 없음)인 팀을 지우려 함(나가기·계정 삭제) | 409 `team-subscription-active` | `account.js` `planLeave` |
| B2 | 팀 결제자(팀장을 넘긴 뒤 포함)가 계정 삭제 | 409 `subscription-active` — 웹훅이 `billing/{결제자}.teamPurchase`에 상태를 적는다 | `subscriptionBlocksDeletion` |
| B2 | 결제 기록이 있는 팀을 지움 | `billing/team_{teamId}`로 옮겨 5년 보관 + 내 좌석 해제 | `deleteTeamKeepingBilling` |
| C1 | 결제 중(해지 예약 없음)인데 또 결제 시작 | 409 `already-subscribed`(Paddle 거래 안 만듦) | `handleBilling` |
| C1 | 다른 구독의 미결제 이벤트가 결제 중 기록을 덮으려 함 | `other-subscription` — 무시 | `otherLiveSubscription` |
| D1 | 동시 참가로 결제 팀 좌석을 넘음 | 들어온 뒤 좌석 순서 밖이면 되돌리고 409 `team-full` · 좌석 동기화 중 결제가 바뀌면 한 번 더 | `joinTeam` · `syncTeamSeats` |
| D2 | 유료 출시 뒤 새 팀 | 처음부터 `locked: true` | `createTeam` |
| D3 | 팀장 자동 복구 응답 | `locked` 포함 | `whoAmI` |
| D4 | 개인 구독이 미결제·해지 | `expireAt` = 기간 끝 + 5년, 다시 결제하면 `null` | `applySubscriptionEvent` |

### 8-5. 요금제 배지 (2026-11-01 사용자 결정 「로고 옆 배지로」)
| 항목 | 내용 |
|---|---|
| 위치 | 사이드패널·확장 설정 페이지 헤더 `S·AI` 오른쪽 작은 알약 — `PRO`(seam 계열)·`TEAM`(dusk 계열), 표시만(누르지 않음). 무료·베타는 배지 없음 |
| 판정 | Worker `POST /v1/billing/me` → `resolvePlan`(한도와 같은 함수). Pro·팀 둘 다면 `TEAM` |
| 조회 시점 | 패널 열기·다시 보임·로그인 변경. 실패는 조용히 배지 없음 |
| 유료화 전 | `FEATURES.billing` 꺼짐이면 묻지도 않는다 |
| 설정 「지금 플랜」 | 결제한 요금제는 배지 + 이름 + 하루 한도(`planSummary`, 숫자는 코어 `PLAN_LIMITS` 한 곳 — Worker 판정과 같은 표). 베타·모름·결제 꺼짐은 출시 기간 문구 그대로 |
| 실측 | 2026-11-01 Worker `b83182d2` · 확장 0.1.69 시험 빌드(`billing=true`) — 팀 좌석 결제 계정에서 사이드패널·설정 헤더·「지금 플랜」 모두 `TEAM` ✔ |

🔴 서명 도입 전에 만든 샌드박스 구독(P7·TP6)은 `sig`가 없어 이후 이벤트가 `unsigned`로 무시된다 — 시험은 새로 결제한다.

## 5. 범위 밖 (이번 PR)
- 팀 요금제(좌석·팀원 연결) — 2단계
- 확장의 업그레이드 버튼·「무료 요금제는 빠른 모드만」 팝업 문구 — 결제 엔드포인트가 샌드박스에서 확인된 뒤
- 사이트 `/checkout` 페이지 — 다음 PR(클라이언트 토큰 사용)
- 처리방침에 「Paddle에 SAI 계정 식별자(uid) 전달」 추가 — 실판매 전 필수
