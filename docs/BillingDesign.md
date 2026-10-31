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
| P7 | 샌드박스 실결제: 테스트 카드로 Pro 결제 → 웹훅 → 같은 계정의 기본 모드 11번째가 그대로 기본(beta 한도면 빠른) 등 요금제 반영 | 🟡 사용자 키·웹훅 등록 뒤 실측 |
| T | `npm test` · Worker 테스트 · `check:bundle` · `build` | 실행 |

## 5. 범위 밖 (이번 PR)
- 팀 요금제(좌석·팀원 연결) — 2단계
- 확장의 업그레이드 버튼·「무료 요금제는 빠른 모드만」 팝업 문구 — 결제 엔드포인트가 샌드박스에서 확인된 뒤
- 사이트 `/checkout` 페이지 — 다음 PR(클라이언트 토큰 사용)
- 처리방침에 「Paddle에 SAI 계정 식별자(uid) 전달」 추가 — 실판매 전 필수
