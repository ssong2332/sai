/**
 * 가짜 Firestore REST 서버 (2026-10-26, L33 2단계) — 🔴 네트워크 없음. `fetch` 자리에 넣는다.
 *
 * 흉내 내는 것 = `src/google/firestoreRest.js`가 부르는 엔드포인트뿐:
 * GET 문서 · GET 컬렉션(showMissing) · :commit(update·updateMask·updateTransforms·delete, transformResults) ·
 * :batchGet · :runQuery(== AND, limit) · :beginTransaction · :rollback · :listCollectionIds.
 * 🔴 저장은 REST 모양(인코딩된 fields) 그대로 — 어댑터의 인코딩이 틀리면 여기서 드러난다.
 * `failCommitOnce(409)`로 트랜잭션 경합을 한 번 만들 수 있다. `calls`에 (method, 경로 끝) 기록.
 */

const API = 'https://firestore.googleapis.com/v1/';

function splitPath(path) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < path.length; i += 1) {
    const ch = path[i];
    if (quoted && ch === '\\') { cur += path[++i]; continue; }
    if (ch === '`') { quoted = !quoted; continue; }
    if (ch === '.' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function getAt(fields, parts) {
  let cur = { mapValue: { fields } };
  for (const p of parts) {
    cur = cur?.mapValue?.fields?.[p];
    if (cur === undefined) return undefined;
  }
  return cur;
}

function setAt(fields, parts, value) {
  let cur = fields;
  for (const p of parts.slice(0, -1)) {
    if (!cur[p]?.mapValue) cur[p] = { mapValue: { fields: {} } };
    cur[p].mapValue.fields ??= {};
    cur = cur[p].mapValue.fields;
  }
  if (value === undefined) delete cur[parts.at(-1)];
  else cur[parts.at(-1)] = value;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const numOf = (v) => (v?.integerValue !== undefined ? Number(v.integerValue) : v?.doubleValue !== undefined ? Number(v.doubleValue) : 0);

export function createFakeFirestore({ projectId = 'sai-global-msg-2026', now = () => new Date('2026-10-26T03:00:00Z') } = {}) {
  const root = `projects/${projectId}/databases/(default)/documents`;
  const docs = new Map(); // name → fields
  const calls = [];
  let commitFailures = [];
  let txSeq = 0;

  const parentOf = (name) => name.slice(0, name.lastIndexOf('/'));
  const json = (status, body) => new globalThis.Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function applyWrite(w) {
    if (w.delete) { docs.delete(w.delete); return { transformResults: [] }; }
    const name = w.update.name;
    let fields = w.updateMask ? clone(docs.get(name) ?? {}) : clone(w.update.fields ?? {});
    if (w.updateMask) {
      for (const path of w.updateMask.fieldPaths) setAt(fields, splitPath(path), clone(getAt(w.update.fields ?? {}, splitPath(path))));
    }
    const transformResults = [];
    for (const t of w.updateTransforms ?? []) {
      const parts = splitPath(t.fieldPath);
      let value;
      if (t.increment) {
        const sum = numOf(getAt(fields, parts)) + numOf(t.increment);
        value = Number.isInteger(sum) ? { integerValue: String(sum) } : { doubleValue: sum };
      } else {
        value = { timestampValue: now().toISOString() };
      }
      setAt(fields, parts, value);
      transformResults.push(value);
    }
    docs.set(name, fields);
    return { transformResults };
  }

  function matches(fields, filter) {
    if (!filter) return true;
    if (filter.compositeFilter) return filter.compositeFilter.filters.every((f) => matches(fields, f));
    const { field, value } = filter.fieldFilter;
    return JSON.stringify(getAt(fields, splitPath(field.fieldPath))) === JSON.stringify(value);
  }

  async function fetchImpl(url, init = {}) {
    const method = init.method ?? 'GET';
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/v1\//, ''));
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: path.slice(root.length) || '/' });
    if (!String(init.headers?.authorization ?? '').startsWith('Bearer ')) return json(401, { error: { status: 'UNAUTHENTICATED' } });

    if (path === `${root}:commit`) {
      const fail = commitFailures.shift();
      if (fail) return json(fail, { error: { status: fail === 409 ? 'ABORTED' : 'INTERNAL' } });
      const writeResults = body.writes.map(applyWrite);
      return json(200, { writeResults, commitTime: now().toISOString() });
    }
    if (path === `${root}:beginTransaction`) return json(200, { transaction: `tx-${++txSeq}` });
    if (path === `${root}:rollback`) return json(200, {});
    if (path === `${root}:batchGet`) {
      return json(200, body.documents.map((name) => (docs.has(name) ? { found: { name, fields: clone(docs.get(name)) } } : { missing: name })));
    }
    if (path.endsWith(':runQuery')) {
      const parent = path.slice(0, -':runQuery'.length);
      const q = body.structuredQuery;
      const prefix = `${parent}/${q.from[0].collectionId}/`;
      let rows = [...docs.entries()].filter(([name]) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'));
      rows = rows.filter(([, fields]) => matches(fields, q.where));
      if (Number.isInteger(q.limit)) rows = rows.slice(0, q.limit);
      return json(200, rows.length ? rows.map(([name, fields]) => ({ document: { name, fields: clone(fields) } })) : [{ readTime: now().toISOString() }]);
    }
    if (path.endsWith(':listCollectionIds')) {
      const doc = path.slice(0, -':listCollectionIds'.length);
      const ids = new Set();
      for (const name of docs.keys()) if (name.startsWith(`${doc}/`)) ids.add(name.slice(doc.length + 1).split('/')[0]);
      return json(200, ids.size ? { collectionIds: [...ids].sort() } : {});
    }
    if (method === 'GET') {
      const depth = path.slice(root.length + 1).split('/').length;
      if (depth % 2 === 0) {
        if (!docs.has(path)) return json(404, { error: { status: 'NOT_FOUND' } });
        return json(200, { name: path, fields: clone(docs.get(path)) });
      }
      // 컬렉션 목록(showMissing) — 바로 아래 문서 + 하위만 있는 문서 이름
      const names = new Set();
      for (const name of docs.keys()) {
        if (!name.startsWith(`${path}/`)) continue;
        const rest = name.slice(path.length + 1).split('/');
        names.add(`${path}/${rest[0]}`);
      }
      return json(200, names.size ? { documents: [...names].sort().map((name) => ({ name })) } : {});
    }
    return json(400, { error: { status: 'INVALID_ARGUMENT' } });
  }

  return {
    fetch: fetchImpl,
    root,
    calls,
    /** 저장된 REST fields(인코딩 그대로). */
    raw: (path) => docs.get(`${root}/${path}`),
    has: (path) => docs.has(`${root}/${path}`),
    names: () => [...docs.keys()].map((n) => n.slice(root.length + 1)).sort(),
    seed(path, fields) { docs.set(`${root}/${path}`, clone(fields)); },
    failCommitOnce(status = 409) { commitFailures.push(status); },
    parentOf,
  };
}

export { API };
