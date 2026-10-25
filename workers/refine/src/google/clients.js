/**
 * env → Google 클라이언트(Firestore REST) — isolate 하나에 한 번만 만든다 (2026-10-26, L33 2단계).
 *
 * 🔴 시크릿 `GOOGLE_SERVICE_ACCOUNT`(서비스 계정 JSON 원문)가 바뀌면 새로 만든다(값으로 메모 — 시크릿 교체 뒤 옛 토큰을 쓰지 않게).
 * 🔴 시크릿이 없으면 null — 부르는 쪽이 「저장소 없음」으로 판정한다(지어낸 값으로 돌지 않는다).
 * 🔴 프로젝트 ID는 `[vars] FIREBASE_PROJECT_ID`(토큰 검증과 같은 값). 서비스 계정 JSON의 project_id와 다르면 쓰지 않는다 —
 *    다른 프로젝트 키로 운영 데이터에 쓰는 사고를 막는다.
 */

import { createTokenSource, parseServiceAccount } from './serviceAccount.js';
import { RestFirestore } from './firestoreRest.js';

const memo = { raw: null, value: null };

export class GoogleConfigError extends Error {
  constructor(code) {
    super(`google config: ${code}`);
    this.name = 'GoogleConfigError';
    this.code = code;
  }
}

/**
 * @param {Record<string, unknown>} env
 * @param {{fetchImpl?: typeof fetch}} [opts]
 * @returns {{ db: RestFirestore, tokenSource: object, projectId: string } | null}
 */
export function googleClientsFromEnv(env = {}, { fetchImpl = globalThis.fetch } = {}) {
  const raw = typeof env.GOOGLE_SERVICE_ACCOUNT === 'string' ? env.GOOGLE_SERVICE_ACCOUNT.trim() : '';
  const projectId = typeof env.FIREBASE_PROJECT_ID === 'string' ? env.FIREBASE_PROJECT_ID.trim() : '';
  if (!raw || !projectId) return null;
  if (memo.raw === raw && memo.value?.projectId === projectId && memo.value.fetchImpl === fetchImpl) return memo.value;
  const account = parseServiceAccount(raw);
  if (account.projectId && account.projectId !== projectId) throw new GoogleConfigError('project-mismatch');
  const tokenSource = createTokenSource({ credentials: raw, fetchImpl });
  const db = new RestFirestore({ projectId, token: () => tokenSource.token(), fetchImpl });
  memo.raw = raw;
  memo.value = { db, tokenSource, projectId, fetchImpl };
  return memo.value;
}

/** 테스트 전용 — 메모를 비운다. */
export function resetGoogleClients() {
  memo.raw = null;
  memo.value = null;
}
