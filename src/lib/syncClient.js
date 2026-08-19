/**
 * 설정 동기화 — Firestore REST (S31 / `docs/WebSplit.md`).
 *
 * 🔴 **1단계 범위: 온보딩 + 학습 패턴(수치)뿐이다** (2026-08-14). 둘 다 `firestore.rules`에
 *    이미 규칙이 있어 배포 없이 된다. 나머지는 의도적으로 뺐다:
 *    - **용어집**: 규칙은 있으나 **사용자 콘텐츠**라 별도 동의 UI가 먼저 필요하다.
 *    - **수신자 태그**: **제3자 정보**라 규칙도 없고 동의도 따로 받아야 한다.
 *    - **상황 템플릿·협업 성향**(`situationId`/`collabStyleId`): 규칙의 필드 화이트리스트에
 *      **없다.** 규칙을 고치고 배포해야 올릴 수 있다 — 몰래 다른 필드에 끼워 넣지 않는다.
 *    - **저장 문구·예약·결정 로그**: 🔴 **본문이다. 어떤 단계에서도 올리지 않는다** (Spec 필수 5).
 *
 * 🔴 **규칙이 최종 방어선이다.** 이 파일이 실수로 다른 필드를 보내도 `firestore.rules`의
 *    `onlyFields()`가 거절한다. 그래서 규칙을 느슨하게 고치는 일이 가장 위험하다.
 *
 * 🔴 `fetch`를 주입받는다 — 네트워크 없이 인코딩·병합 규칙을 전부 테스트하기 위해서다.
 */

import { FIREBASE_PROJECT_ID } from '../config.js';
import { getIdToken } from './authClient.js';
import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

const ROOT = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export const SYNC_ERRORS = {
  NOT_SIGNED_IN: 'not-signed-in',
  REJECTED: 'rejected-by-rules',
  NETWORK: 'network-failed',
  UNKNOWN: 'unknown',
};

export class SyncError extends Error {
  constructor(reason, detail = '') {
    super(`sync:${reason}${detail ? ` (${detail})` : ''}`);
    this.reason = reason;
    this.detail = detail;
  }
}

export function syncErrorMessage(reason, detail = '') {
  const suffix = detail ? ` (${detail})` : '';
  switch (reason) {
    case SYNC_ERRORS.NOT_SIGNED_IN:
      return '먼저 로그인해 주세요';
    case SYNC_ERRORS.REJECTED:
      // 🔴 규칙이 막았다는 것은 **우리가 보내면 안 되는 것을 보냈다**는 뜻이다. 사용자 잘못이
      //    아니므로 "다시 시도"를 권하지 않는다.
      return `보안 규칙이 이 데이터를 거절했어요 — 개발자에게 알려 주세요${suffix}`;
    case SYNC_ERRORS.NETWORK:
      return '동기화 서버에 연결하지 못했어요 — 네트워크를 확인해 주세요';
    default:
      return `동기화에 실패했어요${suffix}`;
  }
}

/* ── Firestore 값 인코딩 ─────────────────────────────────────────────── */

/**
 * 🔴 **문자열·정수·문자열 배열만 만든다.** 임의 객체를 통째로 넣는 경로를 두지 않는다 —
 *    그런 경로가 있으면 나중에 누군가 본문이 든 객체를 그대로 실어 보낸다.
 */
function encodeValue(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { integerValue: String(value) };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: { values: value.filter((v) => typeof v === 'string').map((v) => ({ stringValue: v })) },
    };
  }
  return null;
}

/** `{a: 'x', b: 2}` → Firestore `fields`. 인코딩할 수 없는 값은 **버린다**(추측해 바꾸지 않는다). */
export function encodeFields(object) {
  const fields = {};
  for (const [key, value] of Object.entries(object ?? {})) {
    const encoded = encodeValue(value);
    if (encoded) fields[key] = encoded;
  }
  return fields;
}

/** Firestore `fields` → 평범한 객체. */
export function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if ('stringValue' in value) out[key] = value.stringValue;
    else if ('integerValue' in value) out[key] = Number(value.integerValue);
    else if ('arrayValue' in value) {
      out[key] = (value.arrayValue.values ?? [])
        .map((item) => item.stringValue)
        .filter((item) => typeof item === 'string');
    }
  }
  return out;
}

/* ── REST ───────────────────────────────────────────────────────────── */

async function request(path, { method = 'GET', body, token, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(`${ROOT}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError(SYNC_ERRORS.NETWORK);
  }

  // 404는 "아직 없음"이지 오류가 아니다 — 처음 로그인한 사람에게는 정상 상태다.
  if (response.status === 404) return null;
  if (response.status === 403) throw new SyncError(SYNC_ERRORS.REJECTED, '403');
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new SyncError(SYNC_ERRORS.UNKNOWN, `${response.status} ${detail.slice(0, 80)}`);
  }
  return response.json().catch(() => null);
}

async function requireToken(fetchImpl) {
  const token = await getIdToken({ fetchImpl });
  if (!token) throw new SyncError(SYNC_ERRORS.NOT_SIGNED_IN);
  return token;
}

/* ── 매핑 ───────────────────────────────────────────────────────────── */

/**
 * 로컬 온보딩 → Firestore `users/{uid}` 필드.
 * 🔴 **규칙의 화이트리스트에 있는 이름만 만든다** (`language`·`partnerRegions`·`tone`).
 *    `completedAt`은 규칙에 없어서 보내지 않는다 — 보내면 문서 전체가 거절된다.
 * 🔴 `partnerRegions`가 **복수형**이다. 로컬은 단수 `partnerRegion` 하나라 배열로 감싼다.
 */
export function onboardingToFields(onboarding) {
  const out = {};
  if (onboarding?.language) out.language = onboarding.language;
  if (onboarding?.tone) out.tone = onboarding.tone;
  if (onboarding?.partnerRegion) out.partnerRegions = [onboarding.partnerRegion];
  return out;
}

/** Firestore 문서 → 로컬 온보딩 조각. 🔴 없는 값을 지어내지 않는다. */
export function fieldsToOnboarding(fields) {
  const decoded = decodeFields(fields);
  const out = {};
  if (decoded.language) out.language = decoded.language;
  if (decoded.tone) out.tone = decoded.tone;
  if (Array.isArray(decoded.partnerRegions) && decoded.partnerRegions[0]) {
    out.partnerRegion = decoded.partnerRegions[0];
  }
  return out;
}

/**
 * 학습 횟수 병합 — 🔴 **큰 쪽을 남긴다.**
 * 두 기기에서 각각 쌓였을 때 어느 쪽도 버리지 않으면서, 더하면 같은 학습이 두 번 세어진다
 * (같은 기기가 두 번 올리면 계속 불어난다). 최댓값은 멱등이라 반복 동기화에 안전하다.
 */
export function mergeCounts(local, remote) {
  const out = { ...(local ?? {}) };
  for (const [kind, count] of Object.entries(remote ?? {})) {
    if (!Number.isInteger(count) || count < 0) continue;
    out[kind] = Math.max(out[kind] ?? 0, count);
  }
  return out;
}

/* ── 공개 API ───────────────────────────────────────────────────────── */

/**
 * 양방향 동기화 한 번.
 *
 * 🔴 **가져와서 병합한 뒤 올린다.** 올리기만 하면 다른 기기에서 쌓인 것을 덮어쓰고, 가져오기만
 *    하면 이 기기의 것이 영영 안 올라간다.
 *
 * @returns {Promise<{learnedKinds: number, pulledOnboarding: boolean}>}
 *   🔴 반환값에 본문이 없다 — 수치와 boolean뿐이다.
 */
export async function syncNow({ fetchImpl = globalThis.fetch } = {}) {
  const token = await requireToken(fetchImpl);
  const session = await getLocal(STORAGE_KEYS.AUTH, null);
  const uid = session?.uid;
  if (!uid) throw new SyncError(SYNC_ERRORS.NOT_SIGNED_IN);

  /* 1) 온보딩 — 원격을 먼저 읽고, 로컬에 없는 값만 채운 뒤 합쳐서 올린다. */
  const remoteUser = await request(`/users/${uid}`, { token, fetchImpl });
  const remoteOnboarding = fieldsToOnboarding(remoteUser?.fields);
  const localOnboarding = (await getLocal(STORAGE_KEYS.ONBOARDING, null)) ?? {};
  // 🔴 로컬이 이긴다 — 방금 이 기기에서 바꾼 설정을 원격 값으로 되돌리면 "왜 원래대로 돌아가지"가 된다.
  const mergedOnboarding = { ...remoteOnboarding, ...localOnboarding };
  const pulledOnboarding = Object.keys(remoteOnboarding).some(
    (key) => localOnboarding[key] === undefined,
  );
  if (Object.keys(mergedOnboarding).length > 0) {
    await setLocal(STORAGE_KEYS.ONBOARDING, mergedOnboarding);
    const fields = onboardingToFields(mergedOnboarding);
    const mask = Object.keys(fields)
      .map((key) => `updateMask.fieldPaths=${key}`)
      .join('&');
    // 🔴 updateMask를 주지 않으면 문서의 다른 필드가 지워진다.
    await request(`/users/${uid}?${mask}`, { method: 'PATCH', body: { fields }, token, fetchImpl });
  }

  /* 2) 학습 패턴 — 수치만. */
  const remoteList = await request(`/users/${uid}/learnedPatterns`, { token, fetchImpl });
  const remoteCounts = {};
  for (const doc of remoteList?.documents ?? []) {
    const decoded = decodeFields(doc.fields);
    if (decoded.kind && Number.isInteger(decoded.count)) remoteCounts[decoded.kind] = decoded.count;
  }

  const localCounts = await getLocal(STORAGE_KEYS.LEARNED_PATTERNS, {});
  const merged = mergeCounts(localCounts, remoteCounts);
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, merged);

  for (const [kind, count] of Object.entries(merged)) {
    if (remoteCounts[kind] === count) continue; // 이미 같으면 쓰지 않는다.
    const fields = encodeFields({ kind, count });
    const mask = 'updateMask.fieldPaths=kind&updateMask.fieldPaths=count';
    await request(`/users/${uid}/learnedPatterns/${encodeURIComponent(kind)}?${mask}`, {
      method: 'PATCH',
      body: { fields },
      token,
      fetchImpl,
    });
  }

  return { learnedKinds: Object.keys(merged).length, pulledOnboarding };
}
