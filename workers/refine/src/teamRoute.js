/**
 * `POST /v1/team` — Functions `teamV1`을 Worker로 옮긴 것 (2026-10-26, L33 2단계 U3).
 *
 * 🔴 판정은 전부 `functions/teams.js`·`account.js`·`betaMetrics.js`에 있다 — **고치지 않고 그대로** 부른다.
 *    여기는 라우팅·상태 코드·deps만 맡는다(Functions `index.js` teamV1과 같은 구조). 그래서 판정이 두 벌로 갈라지지 않는다.
 * 🔴 deps 바꿔 끼우기
 * | admin(Functions) | Worker |
 * |---|---|
 * | `getFirestore()` | `RestFirestore`(`google/firestoreRest.js`) |
 * | `getAuth().verifyIdToken` | `verifyFirebaseIdToken`(`auth.js` — 교정과 같은 검증) |
 * | `getAuth().deleteUser` | `createAuthAdmin`(`google/authAdmin.js`) |
 * | `node:crypto randomInt` | `crypto.getRandomValues` 거절 표본(치우침 없음) |
 * 🔴 Zero Retention: 로그에는 액션 이름과 사유 코드만. 요청 본문(팀 이름·이메일·카운트)을 쓰지 않는다.
 * 🔴 `GOOGLE_SERVICE_ACCOUNT`가 없으면 503 `{error:'team-unavailable'}` — 지어낸 성공을 돌려주지 않는다.
 */

import { TEAM_ACTIONS, TeamError } from '../../../functions/teams.js';
import { leaveTeamOnServer, deleteAccount, listMyTeams, accountStore } from '../../../functions/account.js';
import { recordClientMetric } from '../../../functions/betaMetrics.js';
import { verifyFirebaseIdToken } from './auth.js';
import { createAuthAdmin } from './google/authAdmin.js';

/** Functions `index.js` `ACCOUNT_ACTIONS`와 같은 표 — 이름이 TEAM_ACTIONS와 겹치지 않는다. */
const ACCOUNT_ACTIONS = { leave: leaveTeamOnServer, deleteAccount, myTeams: listMyTeams, metric: recordClientMetric };

/** [0, max) 정수 — 거절 표본으로 치우침 없이. 초대 코드 생성용(`teams.js` generateCode). */
export function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('max');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/**
 * @param {Request} request
 * @param {object} ctx
 * @param {{projectId: string}} ctx.config
 * @param {{db: object, tokenSource: object, projectId: string} | null} ctx.google
 * @param {(status: number, body: object) => Response} ctx.json
 * @param {object} ctx.logger
 * @param {Function} [ctx.jwks]
 * @param {() => number} [ctx.now]
 */
export async function handleTeam(request, { config, google, json, logger, jwks, now }) {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'bad request' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad request' });

  const action = String(body.action ?? '');
  const handler = Object.hasOwn(TEAM_ACTIONS, action) ? TEAM_ACTIONS[action] : Object.hasOwn(ACCOUNT_ACTIONS, action) ? ACCOUNT_ACTIONS[action] : null;
  if (!handler) return json(400, { error: 'unknown action' });
  if (!google) {
    logger.error(`[team:${action}] 저장소 없음 — GOOGLE_SERVICE_ACCOUNT 시크릿 필요`);
    return json(503, { error: 'team-unavailable' });
  }

  // Functions `req` 모양 — 판정 코드는 `req.body`·`req.get('Authorization')`만 본다.
  const req = { body, get: (name) => request.headers.get(name) ?? undefined };
  const auth = createAuthAdmin({ projectId: google.projectId, token: () => google.tokenSource.token(), fetchImpl: google.fetchImpl ?? globalThis.fetch });
  const deps = {
    db: () => google.db,
    verifyIdToken: (token) => verifyFirebaseIdToken(token, { projectId: config.projectId, ...(jwks ? { jwks } : {}), now }),
    randomInt,
    accountStore: () => accountStore(google.db, auth),
  };
  try {
    return json(200, await handler(req, deps));
  } catch (error) {
    const status = error instanceof TeamError ? error.status : 500;
    logger.error(`[team:${action}] 거절: ${error?.reason ?? error?.code ?? error?.name ?? 'error'}`);
    // 🔴 `extra`는 판정에 필요한 최소 정보뿐(막고 있는 팀 id·이름) — Functions와 같다.
    return json(status, { error: error?.reason ?? 'failed', ...(error?.extra ?? {}) });
  }
}
