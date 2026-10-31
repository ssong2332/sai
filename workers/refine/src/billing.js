/**
 * 결제(Paddle) — `docs/BillingDesign.md` (2026-10-31 사용자 결정: 유료화 후 공개, 개인 Pro 먼저).
 *
 * | 경로 | 누가 부르나 | 하는 일 |
 * |---|---|---|
 * | `POST /v1/billing/checkout` | 확장(로그인 토큰) | Paddle 거래 생성(`custom_data.uid`) → 결제 주소 |
 * | `POST /v1/billing/webhook` | Paddle 서버(서명) | `subscription.*` → Firestore `billing/{uid}` |
 *
 * 🔴 API 키·웹훅 비밀값은 시크릿에서만 읽고, 응답·로그에 싣지 않는다. 로그에는 이벤트 이름·사유 코드만(uid 없음).
 * 🔴 웹훅은 **서명 검증을 통과한 것만** 처리한다(`verifyPaddleSignature`). 실패는 401, 쓰기 0.
 * 🔴 저장은 요금제 판정에 필요한 값뿐 — 결제 수단·이메일·주소는 받지도 저장하지도 않는다.
 * 🔴 `BILLING_ENFORCED`가 꺼져 있으면 무료 사용자는 `beta`(지금과 같은 한도) — 배포만으로 아무도 덜 쓰게 되지 않는다.
 */

import { verifyFirebaseIdToken, bearerToken, AuthError } from './auth.js';

/** 요금제별 하루 한도 — `docs/BillingDesign.md` 2절 · Spec §0(2026-10-31 확정). */
export const PLAN_LIMITS = Object.freeze({
  beta: Object.freeze({ daily: 100, standard: 10, deep: 3 }),
  free: Object.freeze({ daily: 20, standard: 0, deep: 0 }),
  pro: Object.freeze({ daily: 200, standard: 10, deep: 3 }),
  team: Object.freeze({ daily: 200, standard: 20, deep: 5 }),
});

/** 유료로 치는 구독 상태 — `past_due`는 Paddle이 재청구하는 동안이라 유지한다. */
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** 서명 시각 허용 오차 — 재전송 공격 방지. */
export const SIGNATURE_TOLERANCE_SEC = 300;

const API_BASE = { sandbox: 'https://sandbox-api.paddle.com', live: 'https://api.paddle.com' };

/** env → 결제 설정. 하나라도 빠지면 `ready:false`(503으로 드러낸다). 값 자체는 밖으로 내보내지 않는다. */
export function readBillingConfig(env = {}) {
  const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
  const mode = str(env.PADDLE_ENV);
  const config = {
    apiBase: API_BASE[mode] ?? null,
    apiKey: str(env.PADDLE_API_KEY),
    webhookSecret: str(env.PADDLE_WEBHOOK_SECRET),
    prices: { month: str(env.PADDLE_PRICE_PRO_MONTH), year: str(env.PADDLE_PRICE_PRO_YEAR) },
    // 팀 요금제(2026-11-01, `docs/BillingDesign.md` 8절) — 1석당 가격, 수량 = 좌석.
    teamPrices: { month: str(env.PADDLE_PRICE_TEAM_MONTH), year: str(env.PADDLE_PRICE_TEAM_YEAR) },
    enforced: str(env.BILLING_ENFORCED) === '1',
    // 유료 출시 시각(ISO) — 베타 팀 30일 유예의 기준(`functions/teams.js` judgeTeamJoin). 없으면 유예 판정을 하지 않는다(잠그지 않음).
    enforcedAtMs: Date.parse(str(env.BILLING_ENFORCED_AT) ?? ''),
  };
  config.checkoutReady = Boolean(config.apiBase && config.apiKey && config.prices.month && config.prices.year);
  config.webhookReady = Boolean(config.webhookSecret);
  return config;
}

/**
 * 저장된 구독 문서 → 요금제(`docs/BillingDesign.md` 2절 판정표).
 * @param {object|null} doc `billing/{uid}`
 * @param {{enforced: boolean, prices: {month: string|null, year: string|null}}} config
 */
export function resolvePlan(doc, { enforced = false, prices = {} } = {}) {
  // 팀 좌석이 개인 Pro보다 넉넉하다(200·20·5) — 둘 다 있으면 팀. 좌석 여부는 `syncTeamSeats`가 써 둔다.
  if (doc?.teamSeat?.paid === true) return 'team';
  const proPrices = [prices.month, prices.year].filter(Boolean);
  if (doc && PAID_STATUSES.has(doc.status) && proPrices.includes(doc.priceId)) return 'pro';
  return enforced ? 'free' : 'beta';
}

/** 팀 최소·최대 좌석 — Paddle 가격의 수량 제한과 같은 값(2026-11-01 「최소 2석」). */
export const TEAM_SEATS = Object.freeze({ min: 2, max: 100 });

function millisOf(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const t = Date.parse(value ?? '');
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * 팀 좌석 배정 — 결제 상태·좌석 수와 팀원 `joinedAt` 순서로, 앞에서 N명에게 `billing/{uid}.teamSeat.paid=true`.
 * 🔴 요청마다 팀을 훑지 않도록 결과를 각 팀원 문서에 써 둔다. 웹훅·참가·나가기 때 부른다.
 * 🔴 한계: 한 사람이 결제된 팀 두 곳에 있으면 마지막으로 동기화한 팀이 남는다(드문 경우 — 기록).
 * @returns {Promise<{seated: number, unseated: number}>}
 */
export async function syncTeamSeats(db, teamId) {
  const team = await db.collection('teams').doc(teamId).get();
  const billing = team.exists ? team.get('billing') ?? null : null;
  const paid = Boolean(billing && PAID_STATUSES.has(billing.status));
  const seats = paid ? Number(billing.seats ?? 0) : 0;
  const members = (await db.collection('teams').doc(teamId).collection('members').get()).docs
    .map((d) => ({ uid: d.id, joined: millisOf(d.get('joinedAt')) }))
    .sort((a, b) => a.joined - b.joined || a.uid.localeCompare(b.uid));
  let seated = 0;
  for (const [i, m] of members.entries()) {
    const has = i < seats;
    if (has) seated += 1;
    await db.collection('billing').doc(m.uid).set({ teamSeat: { teamId, paid: has } }, { merge: true });
  }
  return { seated, unseated: members.length - seated };
}

function hexOf(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 길이가 같을 때만 비교하는 상수 시간 비교. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * `Paddle-Signature: ts=<초>;h1=<hex>` — 서명 대상은 `${ts}:${원문 본문}`, HMAC-SHA256(웹훅 비밀값).
 * @returns {Promise<boolean>}
 */
export async function verifyPaddleSignature(rawBody, header, secret, nowMs = Date.now()) {
  if (typeof header !== 'string' || !secret) return false;
  const parts = Object.fromEntries(
    header.split(';').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const ts = Number(parts.ts);
  if (!Number.isFinite(ts) || !parts.h1) return false;
  if (Math.abs(nowMs / 1000 - ts) > SIGNATURE_TOLERANCE_SEC) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.ts}:${rawBody}`));
  return safeEqual(hexOf(mac), String(parts.h1).toLowerCase());
}

/**
 * 구독 이벤트 하나를 `billing/{uid}`에 반영한다. 🔴 저장된 이벤트 시각보다 오래된 것은 덮지 않는다(재전송·순서 뒤바뀜).
 * @returns {Promise<'saved'|'stale'|'ignored'>}
 */
export async function applySubscriptionEvent(db, event) {
  if (!String(event?.event_type ?? '').startsWith('subscription.')) return 'ignored';
  const sub = event.data ?? {};
  const occurredAt = String(event.occurred_at ?? '');
  const teamId = typeof sub.custom_data?.teamId === 'string' ? sub.custom_data.teamId : null;
  if (teamId) return applyTeamEvent(db, teamId, sub, occurredAt);
  const uid = typeof sub.custom_data?.uid === 'string' ? sub.custom_data.uid : null;
  if (!uid || uid.length > 128) return 'ignored';
  const ref = db.collection('billing').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() ?? {} : {};
    if (prev.eventAt && occurredAt && String(prev.eventAt) > occurredAt) return 'stale';
    tx.set(
      ref,
      {
        status: String(sub.status ?? ''),
        priceId: String(sub.items?.[0]?.price?.id ?? ''),
        interval: String(sub.billing_cycle?.interval ?? ''),
        subscriptionId: String(sub.id ?? ''),
        customerId: String(sub.customer_id ?? ''),
        periodEnd: String(sub.current_billing_period?.ends_at ?? ''),
        // 해지 예약(기간 끝에 끝남) — 계정 삭제를 허용하는 조건(`functions/account.js`, 2026-11-01).
        cancelScheduled: sub.scheduled_change?.action === 'cancel',
        eventAt: occurredAt,
        updatedAt: new Date(),
      },
      { merge: true },
    );
    return 'saved';
  });
}

/** 팀원이 나갔다 — 그 사람의 이 팀 좌석을 풀고 남은 팀원으로 다시 배정한다. */
export async function releaseTeamSeat(db, teamId, uid) {
  const ref = db.collection('billing').doc(uid);
  const snap = await ref.get();
  if (snap.exists && snap.get('teamSeat')?.teamId === teamId) {
    await ref.set({ teamSeat: { teamId, paid: false } }, { merge: true });
  }
  await syncTeamSeats(db, teamId);
}

/** 팀 구독 이벤트 → `teams/{teamId}.billing` 갱신 + 좌석 재배정. 옛 이벤트는 덮지 않는다. */
async function applyTeamEvent(db, teamId, sub, occurredAt) {
  if (teamId.length > 128) return 'ignored';
  const ref = db.collection('teams').doc(teamId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'ignored';
    const prev = snap.get('billing') ?? {};
    if (prev.eventAt && occurredAt && String(prev.eventAt) > occurredAt) return 'stale';
    tx.set(
      ref,
      {
        billing: {
          status: String(sub.status ?? ''),
          priceId: String(sub.items?.[0]?.price?.id ?? ''),
          seats: Number(sub.items?.[0]?.quantity ?? 0),
          interval: String(sub.billing_cycle?.interval ?? ''),
          subscriptionId: String(sub.id ?? ''),
          customerId: String(sub.customer_id ?? ''),
          periodEnd: String(sub.current_billing_period?.ends_at ?? ''),
          cancelScheduled: sub.scheduled_change?.action === 'cancel',
          eventAt: occurredAt,
        },
      },
      { merge: true },
    );
    return 'saved';
  });
  if (result === 'saved') await syncTeamSeats(db, teamId);
  return result;
}

/** 팀장인가 — 팀 문서 `ownerUid` 또는 팀원 문서 `role`(`functions/account.js` describe와 같은 판정). */
async function teamOwnerCheck(db, teamId, uid) {
  const team = await db.collection('teams').doc(teamId).get();
  if (!team.exists) return { ok: false, memberCount: 0 };
  const members = await db.collection('teams').doc(teamId).collection('members').get();
  const me = members.docs.find((d) => d.id === uid);
  const isOwner = team.get('ownerUid') === uid || me?.get('role') === 'owner';
  return { ok: isOwner, memberCount: members.docs.length };
}

/** Paddle 거래 생성 → `{transactionId, checkoutUrl}`. 🔴 실패 시 상태 코드만 담은 오류(본문·키 없음). */
export async function createCheckout({ fetchImpl = globalThis.fetch, apiBase, apiKey, priceId, uid, teamId = null, quantity = 1 }) {
  const res = await fetchImpl(`${apiBase}/transactions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity }],
      custom_data: teamId ? { uid, teamId } : { uid },
      collection_mode: 'automatic',
    }),
  });
  if (!res.ok) throw Object.assign(new Error('paddle-error'), { code: `http-${res.status}` });
  const body = await res.json();
  return { transactionId: body?.data?.id ?? null, checkoutUrl: body?.data?.checkout?.url ?? null };
}

/**
 * `/v1/billing/*` 라우팅.
 * @param {Request} request
 * @param {{config: object, billing: object, db: object|null, json: Function, logger: object, jwks?: Function, now: () => number, fetchImpl?: Function}} ctx
 */
export async function handleBilling(request, { config, billing, db, json, logger, jwks, now, fetchImpl }) {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  if (path === '/v1/billing/webhook') {
    if (!billing.webhookReady || !db) return json(503, { error: 'billing-unavailable' });
    const raw = await request.text();
    const ok = await verifyPaddleSignature(raw, request.headers.get('Paddle-Signature'), billing.webhookSecret, now());
    if (!ok) {
      logger.warn('[billing] 웹훅 서명 거절');
      return json(401, { error: 'bad signature' });
    }
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return json(400, { error: 'bad request' });
    }
    try {
      const result = await applySubscriptionEvent(db, event);
      logger.log(`[billing] ${String(event.event_type ?? '-')} → ${result}`);
      return json(200, { ok: true });
    } catch (error) {
      logger.error(`[billing] 기록 실패: ${error?.code ?? error?.name ?? 'unknown'}`);
      // Paddle이 다시 보내도록 5xx.
      return json(500, { error: 'store failed' });
    }
  }

  if (path === '/v1/billing/checkout') {
    if (!billing.checkoutReady) return json(503, { error: 'billing-unavailable' });
    let uid;
    try {
      ({ uid } = await verifyFirebaseIdToken(bearerToken(request), { projectId: config.projectId, ...(jwks ? { jwks } : {}), now }));
    } catch (error) {
      return json(401, { error: 'unauthorized', reason: error instanceof AuthError ? error.reason : 'bad-token' });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'bad request' });
    }
    let priceId = null;
    let teamId = null;
    let quantity = 1;
    if (body?.plan === 'pro') priceId = billing.prices[body?.interval] ?? null;
    if (body?.plan === 'team') {
      priceId = billing.teamPrices[body?.interval] ?? null;
      teamId = typeof body?.teamId === 'string' && body.teamId.length <= 128 ? body.teamId : null;
      quantity = Number(body?.seats);
      if (!priceId) return json(400, { error: 'unknown plan' });
      if (!teamId || !db) return json(400, { error: 'bad request' });
      if (!Number.isInteger(quantity) || quantity < TEAM_SEATS.min || quantity > TEAM_SEATS.max) {
        return json(400, { error: 'bad seats', min: TEAM_SEATS.min, max: TEAM_SEATS.max });
      }
      const owner = await teamOwnerCheck(db, teamId, uid);
      if (!owner.ok) return json(403, { error: 'not-owner' });
      // 구매 때 좌석은 지금 팀원 수 이상(2026-11-01).
      if (quantity < owner.memberCount) return json(400, { error: 'bad seats', min: owner.memberCount, max: TEAM_SEATS.max });
    }
    if (!priceId) return json(400, { error: 'unknown plan' });
    try {
      const out = await createCheckout({ fetchImpl, apiBase: billing.apiBase, apiKey: billing.apiKey, priceId, uid, teamId, quantity });
      if (!out.checkoutUrl) {
        logger.error('[billing] 결제 주소 없음 — Paddle 기본 결제 링크 설정 확인');
        return json(502, { error: 'no checkout url' });
      }
      return json(200, out);
    } catch (error) {
      logger.error(`[billing] 거래 생성 실패: ${error?.code ?? error?.name ?? 'unknown'}`);
      return json(502, { error: 'paddle-error' });
    }
  }

  return json(404, { error: 'not found' });
}
