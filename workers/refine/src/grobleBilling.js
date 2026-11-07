/**
 * 결제(Groble) — `docs/BillingDesign.md` 0절 (2026-11-04 사용자 결정 「groble로 가자」).
 *
 * | 경로 | 누가 부르나 | 하는 일 |
 * |---|---|---|
 * | `POST /v1/billing/checkout` | 확장(로그인 토큰) | 일회용 결제 토큰 발급(`billingRefs/{토큰}`) → `https://groble.im/payment/<상품>?ref=<토큰>` |
 *
 * 🔴 2026-11-04 실측(상품 등록 화면): Groble 정기결제 상품은 **가격 하나·주기 하나**뿐이고 옵션을 둘 곳이 없다.
 *    그래서 요금제·주기·좌석마다 상품을 하나씩 만들고(Pro 2 + 팀 18), `GROBLE_PRODUCTS` 표 한 곳으로 판정한다.
 * | `POST /v1/billing/groble-webhook` | Groble 서버(서명) | 이벤트 판정표(0-5) → `billing/{uid}` 또는 `teams/{teamId}.billing` |
 *
 * 🔴 웹훅 비밀값은 시크릿에서만 읽고 응답·로그에 싣지 않는다. 로그에는 이벤트 이름·사유 코드만(uid 없음).
 * 🔴 서명 검증을 통과한 것만 처리한다. 실패는 401(Groble은 401을 다시 보내지 않는다), 쓰기 0.
 * 🔴 구매자 이메일·전화·이름·카드·질문 답변(`buyer.*`·`paymentMethod.*`·`questionAnswers[]`)은 읽지도 저장하지도 않는다.
 * 🔴 `?ref=`는 구매자가 바꿀 수 있다 — uid·teamId를 싣지 않고 추측할 수 없는 토큰만 싣는다(0-3, 옛 B1).
 */

import { billingExpireAt } from '../../../functions/account.js';
import { syncTeamSeats } from './billing.js';

/** 유료로 치는 상태 — `billing.js`·`functions/account.js`와 같은 표. */
const PAID = new Set(['active', 'trialing', 'past_due']);

/** 서명 시각 허용 오차(초) — Groble 가이드 ±5분. */
export const GROBLE_TOLERANCE_SEC = 300;

/** 결제하지 않은 토큰의 유효 시간 — 2026-11-04 사용자 결정 「24시간」(결제 시각 기준). */
export const REF_TTL_MS = 24 * 60 * 60 * 1000;

/** 팀 좌석 옵션 범위 — 2026-11-04 사용자 결정 「2~10석」. */
export const GROBLE_TEAM_SEATS = Object.freeze({ min: 2, max: 10 });

/** 결제 링크 주소 — Groble 가이드 예시(`https://groble.im/payment/내-상품-ID?ref=…`). */
const PAYMENT_BASE = 'https://groble.im/payment/';

const CYCLE_TO_INTERVAL = { 1: 'month', 12: 'year' };

const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/**
 * `GROBLE_PRODUCTS`(JSON: 상품 ID → `{plan, interval, seats?}`) 읽기. 🔴 판정은 이 표 한 곳.
 * 틀린 줄·같은 (요금제·주기·좌석)이 두 번 나오는 줄은 버린다 — 없는 상품 = `wrong-product`, 쓰기 0.
 */
export function parseGrobleProducts(raw) {
  let obj;
  try {
    obj = JSON.parse(raw ?? '');
  } catch {
    return new Map();
  }
  const out = new Map();
  const seen = new Set();
  if (!obj || typeof obj !== 'object') return out;
  for (const [id, v] of Object.entries(obj)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !v || !['month', 'year'].includes(v.interval)) continue;
    let entry = null;
    if (v.plan === 'pro') entry = { plan: 'pro', interval: v.interval, seats: 1 };
    else if (v.plan === 'team' && Number.isInteger(v.seats) && v.seats >= GROBLE_TEAM_SEATS.min && v.seats <= GROBLE_TEAM_SEATS.max) {
      entry = { plan: 'team', interval: v.interval, seats: v.seats };
    }
    if (!entry) continue;
    const key = productKey(entry.plan, entry.interval, entry.seats);
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(id, entry);
  }
  return out;
}

const productKey = (plan, interval, seats) => `${plan}|${interval}|${plan === 'team' ? seats : 1}`;

/** (요금제·주기·좌석) → 상품 ID. 없으면 null. */
export function findGrobleProduct(products, plan, interval, seats = 1) {
  const want = productKey(plan, interval, seats);
  for (const [id, v] of products) if (productKey(v.plan, v.interval, v.seats) === want) return id;
  return null;
}

/** env → Groble 설정. 값 자체는 밖으로 내보내지 않는다. */
export function readGrobleConfig(env = {}) {
  const config = {
    products: parseGrobleProducts(env.GROBLE_PRODUCTS),
    webhookSecret: str(env.GROBLE_WEBHOOK_SECRET),
  };
  config.checkoutReady = config.products.size > 0;
  config.webhookReady = Boolean(config.webhookSecret && config.products.size > 0);
  return config;
}

function hexOf(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexOf(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

/** 시각 헤더 → 밀리초. 초·밀리초·ISO 모두 받는다(❓ 가이드에 단위가 없다 — 「테스트 발송」으로 확인). */
function timestampMs(value) {
  const s = String(value ?? '').trim();
  if (/^\d{9,11}$/.test(s)) return Number(s) * 1000;
  if (/^\d{12,14}$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * `X-Groble-Signature` = HEX(HMAC-SHA256(비밀값, `{X-Groble-Timestamp}.{원문 본문}`)).
 * 비밀값 교체 뒤 24시간은 `X-Groble-Signature-Previous`(옛 비밀값 서명)도 온다 — 우리는 **지금 비밀값 하나**만
 * 갖고 있으므로 두 헤더 중 하나라도 지금 비밀값과 맞으면 받는다.
 * @param {{signature?: string|null, previous?: string|null, timestamp?: string|null}} headers
 */
export async function verifyGrobleSignature(rawBody, headers, secret, nowMs = Date.now()) {
  if (!secret || typeof rawBody !== 'string') return false;
  const ts = String(headers?.timestamp ?? '').trim();
  const at = timestampMs(ts);
  if (!ts || !Number.isFinite(at) || Math.abs(nowMs - at) > GROBLE_TOLERANCE_SEC * 1000) return false;
  const expected = await hmacHex(secret, `${ts}.${rawBody}`);
  return [headers?.signature, headers?.previous].some((h) => typeof h === 'string' && safeEqual(expected, h.trim().toLowerCase()));
}

/** 결제 토큰 — `sr_` + 무작위 24바이트 base64url(32자). Groble `?ref=` 허용 문자(`A-Za-z0-9-_`)만. */
export function newRefToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `sr_${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

const REF_PATTERN = /^sr_[A-Za-z0-9_-]{32}$/;

/** 문서 ID로 쓰는 멱등 키 — 헤더 값을 그대로 쓰지 않고 해시한다(`/` 등 문서 ID에 못 쓰는 문자). */
async function idempotencyDocId(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key)));
  return hexOf(digest);
}

/**
 * 결제 시작 — 토큰을 만들어 저장하고 결제 링크를 돌려준다. 확인(로그인·팀장·좌석·이미 결제 중)은 부르는 쪽이 끝냈다.
 * @param {{plan: 'pro'|'team', interval: string, uid: string, teamId?: string|null, seats?: number}} want
 * @returns {Promise<{checkoutUrl: string}|null>} null = 그 (요금제·주기·좌석) 상품이 표에 없다
 */
export async function createGrobleCheckout(db, groble, want, nowMs = Date.now()) {
  const product = findGrobleProduct(groble.products, want.plan, want.interval, want.seats ?? 1);
  if (!product) return null;
  const ref = newRefToken();
  await db.collection('billingRefs').doc(ref).set({
    uid: want.uid,
    teamId: want.teamId ?? null,
    plan: want.plan,
    interval: want.interval,
    productId: product,
    createdAt: new Date(nowMs).toISOString(),
    boundAt: null,
  });
  return { checkoutUrl: `${PAYMENT_BASE}${encodeURIComponent(product)}?ref=${ref}` };
}

function isoMs(value) {
  const t = Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? t : NaN;
}

/** 이 이벤트가 저장된 것보다 오래됐는가(순서 보장 없음 — `occurredAt`으로 판정). */
function isStale(prev, occurredAt) {
  const a = isoMs(prev?.eventAt);
  const b = isoMs(occurredAt);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

/**
 * 첫 결제(`INITIAL`) 때 토큰과 결제가 맞는지. 결제 링크가 상품 하나를 가리키므로 **상품이 같아야** 한다.
 * | 조건 | 결과 |
 * |---|---|
 * | `content.id`가 토큰의 상품과 다름 · 상품이 표에 없음 · 주기 값이 표와 다름 | `wrong-product` |
 * | 결제 시각이 토큰 생성 + 24시간 뒤 | `expired-ref`(부르는 쪽) |
 */
function checkProduct(groble, token, obj) {
  const id = String(obj?.content?.id ?? '');
  const product = groble.products.get(id);
  if (!product || id !== String(token.productId ?? '') || product.plan !== token.plan) return { error: 'wrong-product' };
  const cycle = CYCLE_TO_INTERVAL[Number(obj?.subscription?.billingCycleMonths)];
  if (cycle && cycle !== product.interval) return { error: 'wrong-product' };
  return { product };
}

/**
 * 이벤트 → 상태(`docs/BillingDesign.md` 0-5 판정표). 쓸 값만 돌려준다(쓰기는 `applyGrobleEvent`).
 * @returns {{status?: string, patch: object}|null} null = 이 이벤트로 바꿀 것 없음
 */
function stateFor(type, obj) {
  const sub = obj?.subscription ?? {};
  if (type === 'subscription_payment.completed') {
    return { status: 'active', patch: { periodEnd: str(sub.nextBillingDate) ?? '', cancelScheduled: false, graceEnd: null } };
  }
  if (type === 'subscription_payment.failed') {
    if (String(sub.status ?? '').toUpperCase() === 'CANCELLED') return { status: 'canceled', patch: { endedAt: str(obj?.failure?.failedAt) } };
    return { status: 'past_due', patch: { graceEnd: obj?.failure?.isFinal === true ? str(obj?.failure?.gracePeriodEndsAt) : null } };
  }
  if (type === 'subscription.cancel_requested') return { patch: { cancelScheduled: true } };
  if (type === 'subscription.terminated') return { status: 'canceled', patch: { endedAt: str(obj?.termination?.terminatedAt) } };
  // 2026-11-04 사용자 결정 「환불 즉시 끄기」 — 전체·부분 같음.
  if (type === 'subscription_payment.refunded') return { status: 'canceled', patch: { endedAt: str(obj?.refund?.refundedAt), lastRefundAt: str(obj?.refund?.refundedAt) } };
  return null;
}

const HANDLED = new Set([
  'subscription_payment.completed',
  'subscription_payment.failed',
  'subscription.cancel_requested',
  'subscription.terminated',
  'subscription_payment.refunded',
]);

/**
 * 웹훅 이벤트 하나 반영.
 * @returns {Promise<'saved'|'stale'|'ignored'|'duplicate'|'unknown-ref'|'expired-ref'|'wrong-product'>}
 */
export async function applyGrobleEvent(db, event, groble, idempotencyKey = null) {
  const type = String(event?.type ?? '');
  if (!HANDLED.has(type)) return 'ignored';
  const obj = event?.data?.object ?? {};
  const occurredAt = String(event?.occurredAt ?? '');

  /**
   * 🔴 2026-11-07 점검 — 중복 표시를 **먼저 차지한다**(없을 때만 만들기). 예전엔 「있나 확인 → 처리 → 표시」라서
   *    같은 웹훅이 동시에 두 번 오면 둘 다 확인을 통과해 두 번 처리될 틈이 있었다.
   *    처리 결과가 예전에 표시를 남기지 않던 경우(토큰 못 찾음·상품 다름·ignored·오류)는 표시를 다시 지운다 — 재시도 동작은 예전과 같다.
   */
  const markId = idempotencyKey ? await idempotencyDocId(idempotencyKey) : null;
  const markRef = markId ? db.collection('billingEvents').doc(markId) : null;
  if (markRef && !(await markRef.create({ at: new Date().toISOString() }))) return 'duplicate';
  let outcome;
  try {
    outcome = await processGrobleEvent(db, type, obj, occurredAt, groble);
  } catch (error) {
    if (markRef) await markRef.delete().catch(() => {});
    throw error;
  }
  if (markRef && !outcome.keepMark) await markRef.delete().catch(() => {});
  return outcome.result;
}

/** 표시 차지 뒤의 실제 처리. `keepMark` = 예전 코드가 표시를 남기던 경우(상태를 반영했고 `ignored`가 아님). */
async function processGrobleEvent(db, type, obj, occurredAt, groble) {
  const done = (result, keepMark = false) => ({ result, keepMark });
  // 토큰 찾기 — 환불에는 `sellerReference`가 없어 회차 기록(`billingRounds/{merchantUid}`)으로 찾는다.
  let ref = str(obj.sellerReference);
  const merchantUid = str(obj.merchantUid);
  if (type === 'subscription_payment.refunded') {
    if (!merchantUid || merchantUid.length > 128 || merchantUid.includes('/')) return done('unknown-ref');
    const round = await db.collection('billingRounds').doc(merchantUid).get();
    ref = round.exists ? str(round.get('ref')) : null;
  }
  if (!ref || !REF_PATTERN.test(ref)) return done('unknown-ref');
  const tokenRef = db.collection('billingRefs').doc(ref);
  const tokenSnap = await tokenRef.get();
  if (!tokenSnap.exists) return done('unknown-ref');
  const token = tokenSnap.data() ?? {};

  let product = token.boundAt ? groble.products.get(String(token.productId ?? '')) ?? null : null;
  // 🔴 2026-11-07 점검 — 묶인 토큰도 이벤트에 실린 상품이 토큰 상품과 같아야 한다. 예전엔 첫 결제만 대조해서,
  //    팀 상품을 한 번 결제해 묶은 `ref`를 싼 Pro 결제 링크에 붙이면 Pro 결제마다 팀이 active로 갱신됐다.
  //    상품 id가 없는 이벤트(환불·해지 일부)는 회차 기록·토큰으로만 찾으므로 그대로 둔다.
  const eventProductId = str(obj?.content?.id);
  if (token.boundAt && eventProductId && eventProductId !== String(token.productId ?? '')) return done('wrong-product');
  if (!token.boundAt) {
    // 묶이지 않은 토큰은 첫 결제 완료로만 묶인다. 그 밖의 이벤트(실패·해지·환불)는 묶인 토큰에만 온다.
    if (type !== 'subscription_payment.completed') return done('unknown-ref');
    const checked = checkProduct(groble, token, obj);
    if (checked.error) return done(checked.error);
    const paidAt = isoMs(obj?.payment?.purchasedAt) || isoMs(occurredAt);
    // 🔴 판정은 결제 시각 — 웹훅 도착 시각이 아니다(Groble 재시도가 최대 약 44시간 늦을 수 있다).
    if (!Number.isFinite(paidAt) || paidAt > isoMs(token.createdAt) + REF_TTL_MS) return done('expired-ref');
    product = checked.product;
    await tokenRef.set({ boundAt: new Date().toISOString() }, { merge: true });
  }
  if (!product) return done('wrong-product');

  if (type === 'subscription_payment.completed' && merchantUid && merchantUid.length <= 128 && !merchantUid.includes('/')) {
    await db.collection('billingRounds').doc(merchantUid).set({ ref });
  }

  const next = stateFor(type, obj);
  const common = { provider: 'groble', plan: product.plan, interval: product.interval, productId: String(token.productId), ref };
  const result = token.teamId
    ? await applyTeam(db, token, product, next, common, occurredAt)
    : await applyPersonal(db, token.uid, next, common, occurredAt);
  return done(result, result !== 'ignored');
}

async function applyPersonal(db, uid, next, common, occurredAt) {
  if (typeof uid !== 'string' || uid === '' || uid.length > 128) return 'ignored';
  const ref = db.collection('billing').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() ?? {} : {};
    if (isStale(prev, occurredAt)) return 'stale';
    const status = next.status ?? String(prev.status ?? '');
    const periodEnd = next.patch.periodEnd ?? prev.periodEnd ?? '';
    tx.set(
      ref,
      {
        ...common,
        ...next.patch,
        status,
        eventAt: occurredAt,
        updatedAt: new Date(),
        // 결제가 끝나면 보관 만료(기간 끝 + 5년), 다시 결제하면 지운다(7절·D4).
        expireAt: PAID.has(status) ? null : billingExpireAt({ periodEnd }, eventDateOf(occurredAt)),
      },
      { merge: true },
    );
    return 'saved';
  });
}

async function applyTeam(db, token, product, next, common, occurredAt) {
  const teamId = String(token.teamId);
  const payerUid = String(token.uid ?? '');
  if (teamId.length > 128 || !payerUid) return 'ignored';
  const ref = db.collection('teams').doc(teamId);
  let status = '';
  let merged = {};
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'ignored';
    const prev = snap.get('billing') ?? {};
    if (isStale(prev, occurredAt)) return 'stale';
    status = next.status ?? String(prev.status ?? '');
    merged = { ...prev, ...common, ...next.patch, status, seats: product.seats, eventAt: occurredAt, payerUid };
    tx.set(ref, { billing: merged }, { merge: true });
    return 'saved';
  });
  if (result !== 'saved') return result;
  await db.collection('billing').doc(payerUid).set(
    {
      teamPurchase: {
        teamId,
        provider: 'groble',
        status,
        cancelScheduled: merged.cancelScheduled === true,
        periodEnd: String(merged.periodEnd ?? ''),
      },
    },
    { merge: true },
  );
  if (PAID.has(status)) await ref.set({ locked: false }, { merge: true });
  await syncTeamSeats(db, teamId);
  return 'saved';
}

function eventDateOf(occurredAt) {
  const t = isoMs(occurredAt);
  return Number.isFinite(t) ? new Date(t) : new Date();
}
