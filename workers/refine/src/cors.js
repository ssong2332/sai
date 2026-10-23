/**
 * CORS — 확장 오리진(`chrome-extension://<EXTENSION_ID>`) 하나만 허용.
 *
 * 🔴 **CORS는 보안 장치가 아니다**(`functions/index.js` refineV1 주석과 같다). 브라우저가 남의 사이트 JS를
 *    막아 줄 뿐이고 curl·서버는 무시한다. 진짜 방어선은 `auth.js` 토큰 검증이다.
 *
 * 판정표
 * | `Origin` 헤더 | 처리 |
 * |---|---|
 * | 없음 (curl·서버) | 통과, CORS 헤더 없음 — 기존 서버와 같다(CLAUDE.md의 무인증 curl → 401 확인 절차가 그대로 쓰인다) |
 * | 확장 오리진과 정확히 일치 | 통과 + `Access-Control-Allow-Origin` |
 * | 그 밖 | **403 JSON**, CORS 헤더 없음 — 🔴 기존(Express `cors`)은 헤더만 빼고 핸들러를 돌렸다. Worker는 LLM을
 * |  | 부르기 **전에** 끊는다(남의 사이트에서 로그인 토큰을 실어 보내는 경우까지 비용을 안 태운다) |
 */

const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization';

/** @returns {'none'|'allowed'|'rejected'} */
export function judgeOrigin(request, extensionId) {
  const origin = request.headers.get('Origin');
  if (origin === null || origin === '') return 'none';
  return origin === `chrome-extension://${extensionId}` ? 'allowed' : 'rejected';
}

/** 허용된 오리진일 때만 붙일 헤더. */
export function corsHeaders(extensionId) {
  return {
    'Access-Control-Allow-Origin': `chrome-extension://${extensionId}`,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}
