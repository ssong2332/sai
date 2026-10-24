/**
 * 웹 ↔ 확장 브리지 클라이언트.
 *
 * 🔴 **데이터는 서버로 가지 않는다.** 이 모듈이 하는 일은 같은 컴퓨터에 설치된 확장에
 *    `chrome.runtime.sendMessage(EXT_ID, …)`로 묻고 답을 받는 것뿐이다. fetch를 쓰지 않는다.
 * 🔴 **조용히 데모로 떨어지지 않는다.** 연결이 안 되면 「연결 안 됨」을 사유와 함께 돌려주고,
 *    가짜 데이터는 `?demo=1`일 때만 `fakeBridge.js`가 만든다.
 *
 * 프로토콜 1 (확장 쪽은 같은 계약으로 따로 만든다):
 *   site:hello · site:get · site:set · site:glossary:add|update|remove · site:learned:remove|clear
 *   응답: `{ok:true, ...}` / `{ok:false, error:'forbidden_origin'|'bad_request'|'unknown_type'|'failed'}`
 */

export const EXT_ID = 'ogbcccaaojphhgobeeidpafokjieckdf';
export const PROTOCOL = 1;
export const TIMEOUT_MS = 3000;

/** 브리지 자체가 만드는 오류 코드 — 확장이 돌려주는 4개와 겹치지 않는다. */
export const BRIDGE_ERRORS = {
  NO_RUNTIME: 'no_runtime', // chrome.runtime.sendMessage가 없다 — 크롬이 아니거나, 이 페이지를 허용한 확장이 없다
  NO_RECEIVER: 'no_receiver', // runtime.lastError — 확장이 없거나 꺼져 있거나 응답 처리기가 없다
  TIMEOUT: 'timeout',
  BAD_RESPONSE: 'bad_response',
};

/**
 * 확장에 메시지 하나를 보내고 결과를 **항상 resolve**한다(reject하지 않는다).
 * 호출부가 try/catch 없이 `result.ok`만 보면 되게 하려는 것이다.
 *
 * @param {object} message
 * @param {{runtime?: any, extId?: string, timeoutMs?: number}} [deps] 테스트용 주입
 * @returns {Promise<{ok: true} & Record<string, any> | {ok: false, error: string}>}
 */
export function sendToExtension(message, deps = {}) {
  const runtime = 'runtime' in deps ? deps.runtime : globalThis.chrome?.runtime;
  const extId = deps.extId ?? EXT_ID;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  if (!runtime || typeof runtime.sendMessage !== 'function') {
    return Promise.resolve({ ok: false, error: BRIDGE_ERRORS.NO_RUNTIME });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, error: BRIDGE_ERRORS.TIMEOUT }), timeoutMs);

    try {
      runtime.sendMessage(extId, message, (response) => {
        // 🔴 lastError는 콜백 안에서 **읽어야** 한다 — 읽지 않으면 크롬이 콘솔에 「Unchecked
        //    runtime.lastError」를 남긴다. 메시지 문구는 쓰지 않는다(브라우저마다 다르다).
        const lastError = runtime.lastError;
        if (lastError) {
          finish({ ok: false, error: BRIDGE_ERRORS.NO_RECEIVER });
          return;
        }
        finish(normalizeResponse(response));
      });
    } catch {
      // 확장 id가 잘못됐거나 허용되지 않은 페이지에서 동기적으로 던지는 경우.
      finish({ ok: false, error: BRIDGE_ERRORS.NO_RECEIVER });
    }
  });
}

/** 확장 응답을 `{ok:…}` 모양으로 강제한다. 모양이 다르면 bad_response. */
export function normalizeResponse(response) {
  if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    return { ok: false, error: BRIDGE_ERRORS.BAD_RESPONSE };
  }
  if (response.ok) return response;
  return { ok: false, error: typeof response.error === 'string' ? response.error : 'failed' };
}

/**
 * `site:hello` 결과를 화면이 쓰는 연결 상태로 바꾼다.
 *
 * | hello 결과 | 상태 |
 * |---|---|
 * | ok + protocol ≥ 1 | connected |
 * | ok + protocol 없음/0 · error unknown_type | outdated (확장이 이 페이지를 모르는 옛 버전) |
 * | error forbidden_origin | forbidden (이 주소를 확장이 허용하지 않음) |
 * | no_runtime · no_receiver · timeout · 그 밖 | not_connected |
 */
export function interpretHello(result) {
  if (result.ok) {
    const protocol = Number(result.protocol) || 0;
    if (protocol < PROTOCOL) return { state: 'outdated', reason: 'old_protocol', version: result.version ?? null };
    return {
      state: 'connected',
      protocol,
      version: typeof result.version === 'string' ? result.version : null,
      signedIn: result.signedIn === true,
    };
  }
  if (result.error === 'unknown_type') return { state: 'outdated', reason: 'unknown_type' };
  if (result.error === 'forbidden_origin') return { state: 'forbidden', reason: result.error };
  return { state: 'not_connected', reason: result.error };
}

/**
 * 오류 코드 → 사용자 문구(무엇이 안 됐고 무엇을 하면 되는지).
 * 🔴 확장이 돌려준 원문 메시지를 화면에 싣지 않는다 — 코드만 받는다.
 */
export function describeError(code) {
  switch (code) {
    case BRIDGE_ERRORS.NO_RUNTIME:
      return '확장과 연결할 수 없어요. Chrome에서 사이 확장을 설치하거나 최신 버전으로 업데이트한 뒤 이 페이지를 새로고침하세요.';
    case BRIDGE_ERRORS.NO_RECEIVER:
      return '확장이 응답하지 않아요. chrome://extensions에서 사이가 켜져 있는지 확인하고 이 페이지를 새로고침하세요.';
    case BRIDGE_ERRORS.TIMEOUT:
      return '확장이 3초 안에 답하지 않았어요. 잠시 뒤 다시 시도하세요.';
    case BRIDGE_ERRORS.BAD_RESPONSE:
      return '확장의 답을 읽지 못했어요. 확장을 최신 버전으로 업데이트하세요.';
    case 'forbidden_origin':
      return '이 주소는 확장이 허용하지 않은 페이지예요. 사이 공식 사이트에서 다시 열어 주세요.';
    case 'bad_request':
      return '저장하지 못했어요. 입력한 값을 확인하고 다시 시도하세요.';
    case 'unknown_type':
      return '확장이 이 기능을 아직 모르는 버전이에요. 확장을 최신 버전으로 업데이트하세요.';
    default:
      return '저장하지 못했어요. 다시 시도하세요. 계속되면 확장을 다시 로드하세요.';
  }
}

/**
 * 화면이 쓰는 클라이언트. 실제 확장 브리지와 데모 브리지가 같은 모양이다 —
 * `send`만 다르고 위의 메서드는 같다.
 *
 * @param {(message: object) => Promise<object>} send
 */
export function createClient(send) {
  return {
    hello: () => send({ type: 'site:hello' }),
    get: () => send({ type: 'site:get' }),
    set: (section, patch) => send({ type: 'site:set', section, patch }),
    addGlossary: (entry) => send({ type: 'site:glossary:add', entry }),
    updateGlossary: (id, patch) => send({ type: 'site:glossary:update', id, patch }),
    removeGlossary: (id) => send({ type: 'site:glossary:remove', id }),
    removeLearned: (categoryId) => send({ type: 'site:learned:remove', categoryId }),
    clearLearned: () => send({ type: 'site:learned:clear' }),
  };
}

/** 실제 확장과 이야기하는 클라이언트. */
export function createExtensionClient(deps) {
  return createClient((message) => sendToExtension(message, deps));
}
