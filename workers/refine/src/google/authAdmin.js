/**
 * Firebase Auth 관리 REST — 계정 삭제 하나뿐 (2026-10-26, L33 2단계 U3).
 *
 * 🔴 `functions/account.js` `accountStore(db, auth)`가 부르는 것은 `auth.deleteUser(uid)`뿐이다 — 그것만 만든다.
 * 🔴 admin과 같게, 없는 사용자는 `code: 'auth/user-not-found'`로 던진다(account.js가 그걸 성공으로 본다 — 멱등).
 * 🔴 서비스 계정에 「Firebase 인증 관리자」 역할이 있어야 한다(없으면 403 → `auth/forbidden`).
 */

const API = 'https://identitytoolkit.googleapis.com/v1/';

export class AuthAdminError extends Error {
  constructor(code, status) {
    super(`auth admin: ${code} (${status})`);
    this.name = 'AuthAdminError';
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {{projectId: string, token: () => Promise<string>, fetchImpl?: typeof fetch}} opts
 */
export function createAuthAdmin({ projectId, token, fetchImpl = globalThis.fetch }) {
  return {
    async deleteUser(uid) {
      const response = await fetchImpl(`${API}projects/${projectId}/accounts:delete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ localId: uid }),
      });
      if (response.ok) return;
      const body = await response.json().catch(() => null);
      const message = String(body?.error?.message ?? '');
      if (message.startsWith('USER_NOT_FOUND')) throw new AuthAdminError('auth/user-not-found', response.status);
      throw new AuthAdminError(response.status === 403 ? 'auth/forbidden' : 'auth/failed', response.status);
    },
  };
}
