/**
 * Firestore REST — firebase-admin `Firestore`와 **같은 모양의 작은 부분집합** (2026-10-26, L33 2단계 U1).
 *
 * 🔴 왜 이 모양인가: Functions의 판정 코드(`functions/teams.js`·`account.js`·`refineQuota.js`·`betaMetrics.js`)는
 *    Firestore를 `deps.db()`로 받는다. 같은 모양을 주면 Worker가 그 코드를 **고치지 않고** 부른다 — 판정이
 *    두 벌로 갈라지지 않는다(「세 곳에 같은 규칙」 함정, CLAUDE.md).
 * 🔴 지원 범위 = 그 네 파일이 실제로 쓰는 것뿐(2026-10-26 grep으로 셈). 없는 기능은 만들지 않는다 —
 *    부르면 `TypeError`로 바로 드러난다(조용히 다른 동작을 하지 않는다).
 *
 * | admin API | 여기 | REST |
 * |---|---|---|
 * | `db.collection(path)` · `.doc(id)` · `ref.collection(id)` | 경로 객체 | — |
 * | `ref.get()` | 문서 1개 | `GET {name}` (404 → 없음) |
 * | `ref.set(data, {merge})` · `ref.delete()` | 쓰기 1개 | `:commit` |
 * | `coll.where(f,'==',v)…limit(n).get()` | 같음(AND만) | `:runQuery` |
 * | `coll.listDocuments()` | 없는 문서(하위만 있는 것)도 | `GET ?showMissing=true` |
 * | `db.batch()` | `set`·`delete`·`commit` | `:commit` |
 * | `db.runTransaction(fn)` | `tx.get(ref|query)`·`set`·`delete`, ABORTED면 재시도 | `:beginTransaction` → `:commit`/`:rollback` |
 * | `db.getAll(...refs)` | 요청 순서대로 | `:batchGet` |
 * | `db.recursiveDelete(ref)` | 하위 컬렉션까지 | `:listCollectionIds` + `:commit` |
 * | `FieldValue.increment(n)` · `serverTimestamp()` | 쓰기 변환 | `updateTransforms` |
 *
 * 🔴 `set(…, {merge:true})`는 admin처럼 **잎 경로만** 고친다(중첩 객체도 잎까지 내려가 updateMask). merge가 없으면 통째로 바꾼다.
 * 🔴 정수는 `integerValue`, 소수는 `doubleValue`. 읽은 타임스탬프는 `Timestamp`로 돌려줘서 다시 쓰면 타임스탬프로 간다.
 * 🔴 Zero Retention: 이 모듈은 받은 값을 저장소에 쓸 뿐 로그를 남기지 않는다. 오류에는 상태·gRPC 상태만 싣는다.
 */

const API = 'https://firestore.googleapis.com/v1/';
const COMMIT_CHUNK = 400; // 한 commit의 쓰기 상한 500보다 여유를 둔다
const TX_ATTEMPTS = 5;

/* ── 값 ─────────────────────────────────────────────────────────────── */

class Sentinel {
  constructor(kind, operand) {
    this.kind = kind;
    this.operand = operand;
  }
}

export const FieldValue = {
  increment: (n) => new Sentinel('increment', n),
  serverTimestamp: () => new Sentinel('serverTimestamp'),
};

/** 읽은 타임스탬프. admin `Timestamp`처럼 `toDate()`·`toMillis()`가 있다. */
export class Timestamp {
  constructor(iso) {
    this.iso = iso;
  }
  toDate() {
    return new Date(this.iso);
  }
  toMillis() {
    return Date.parse(this.iso);
  }
  static fromDate(date) {
    return new Timestamp(date.toISOString());
  }
}

export class FirestoreRestError extends Error {
  constructor(status, grpc, where) {
    super(`firestore ${where}: ${status}${grpc ? ` ${grpc}` : ''}`);
    this.name = 'FirestoreRestError';
    this.status = status;
    this.grpc = grpc;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
  && !(v instanceof Timestamp) && !(v instanceof Sentinel);

export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (v instanceof Timestamp) return { timestampValue: v.iso };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (v instanceof Sentinel) throw new TypeError('FieldValue는 배열·중첩 안에 둘 수 없다');
  return { mapValue: { fields: encodeFields(v) } };
}

export function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = encodeValue(v);
  return out;
}

export function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return new Timestamp(v.timestampValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {});
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decodeValue);
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}

/** 필드 경로 한 칸 — 영문·숫자·_ 아니면 백틱으로 감싼다(REST 규칙). */
const segment = (s) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : `\`${s.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``);

/**
 * 쓰기 데이터 → `{fields, mask, transforms}`. merge면 잎 경로를 mask에 모은다.
 * Sentinel은 fields에서 빼고 transforms로 옮긴다(admin과 같은 동작).
 */
export function splitWrite(data, merge) {
  const transforms = [];
  const mask = [];
  const walk = (obj, prefix) => {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const path = prefix ? `${prefix}.${segment(k)}` : segment(k);
      if (v instanceof Sentinel) {
        if (v.kind === 'increment') transforms.push({ fieldPath: path, increment: encodeValue(v.operand) });
        else transforms.push({ fieldPath: path, setToServerValue: 'REQUEST_TIME' });
      } else if (merge && isPlainObject(v) && Object.keys(v).length > 0) {
        const inner = walk(v, path);
        if (Object.keys(inner).length > 0) fields[k] = { mapValue: { fields: inner } };
      } else if (!merge && isPlainObject(v)) {
        fields[k] = { mapValue: { fields: walk(v, path) } };
      } else {
        fields[k] = encodeValue(v);
        if (merge) mask.push(path);
      }
    }
    return fields;
  };
  const fields = walk(data, '');
  return { fields, mask, transforms };
}

function parsePath(path) {
  const parts = String(path).split('/').filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..')) throw new TypeError('잘못된 경로');
  return parts;
}

function autoId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/* ── 스냅샷 ─────────────────────────────────────────────────────────── */

class DocumentSnapshot {
  constructor(ref, fields) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = fields !== null;
    this._data = fields === null ? undefined : decodeFields(fields);
  }
  data() {
    return this._data === undefined ? undefined : { ...this._data };
  }
  get(path) {
    if (this._data === undefined) return undefined;
    let cur = this._data;
    for (const part of String(path).split('.')) {
      if (cur === null || typeof cur !== 'object' || !(part in cur)) return undefined;
      cur = cur[part];
    }
    return cur;
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(fn) {
    this.docs.forEach(fn);
  }
}

/* ── 경로 ───────────────────────────────────────────────────────────── */

class DocumentReference {
  constructor(db, parts) {
    if (parts.length % 2 !== 0) throw new TypeError('문서 경로는 짝수 칸이어야 한다');
    this._db = db;
    this._parts = parts;
    this.id = parts[parts.length - 1];
    this.path = parts.join('/');
  }
  get name() {
    return `${this._db.root}/${this.path}`;
  }
  get parent() {
    return new CollectionReference(this._db, this._parts.slice(0, -1));
  }
  collection(id) {
    return new CollectionReference(this._db, [...this._parts, ...parsePath(id)]);
  }
  async get() {
    return this._db._getDoc(this);
  }
  async set(data, options = {}) {
    await this._db._commit([this._db._setWrite(this, data, options)]);
  }
  async delete() {
    await this._db._commit([{ delete: this.name }]);
  }
}

class Query {
  constructor(db, parts, filters = [], limitN = null) {
    this._db = db;
    this._parts = parts; // 컬렉션 경로
    this._filters = filters;
    this._limit = limitN;
  }
  where(field, op, value) {
    if (op !== '==') throw new TypeError(`지원하지 않는 비교: ${op}`);
    return new Query(this._db, this._parts, [...this._filters, { field, value }], this._limit);
  }
  limit(n) {
    return new Query(this._db, this._parts, this._filters, n);
  }
  _body() {
    const structuredQuery = { from: [{ collectionId: this._parts[this._parts.length - 1] }] };
    const filters = this._filters.map(({ field, value }) => ({
      fieldFilter: { field: { fieldPath: field.split('.').map(segment).join('.') }, op: 'EQUAL', value: encodeValue(value) },
    }));
    if (filters.length === 1) structuredQuery.where = filters[0];
    else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
    if (Number.isInteger(this._limit)) structuredQuery.limit = this._limit;
    return structuredQuery;
  }
  _parentName() {
    const parentDoc = this._parts.slice(0, -1);
    return parentDoc.length ? `${this._db.root}/${parentDoc.join('/')}` : this._db.root;
  }
  async get() {
    return this._db._runQuery(this);
  }
}

class CollectionReference extends Query {
  constructor(db, parts) {
    if (parts.length % 2 !== 1) throw new TypeError('컬렉션 경로는 홀수 칸이어야 한다');
    super(db, parts);
    this.id = parts[parts.length - 1];
    this.path = parts.join('/');
  }
  doc(id) {
    return new DocumentReference(this._db, [...this._parts, ...parsePath(id ?? autoId())]);
  }
  async listDocuments() {
    const refs = [];
    let pageToken = '';
    do {
      const qs = new URLSearchParams({ showMissing: 'true', pageSize: '300', 'mask.fieldPaths': '__name__' });
      if (pageToken) qs.set('pageToken', pageToken);
      const body = await this._db._request('GET', `${this._parentName()}/${this.id}?${qs}`, null, 'list');
      for (const doc of body?.documents ?? []) refs.push(this._db._refFromName(doc.name));
      pageToken = body?.nextPageToken ?? '';
    } while (pageToken);
    return refs;
  }
}

/* ── 묶음 쓰기 · 트랜잭션 ─────────────────────────────────────────────── */

class WriteBatch {
  constructor(db) {
    this._db = db;
    this._writes = [];
  }
  set(ref, data, options = {}) {
    this._writes.push(this._db._setWrite(ref, data, options));
    return this;
  }
  delete(ref) {
    this._writes.push({ delete: ref.name });
    return this;
  }
  async commit() {
    if (this._writes.length) await this._db._commit(this._writes);
  }
}

class Transaction {
  constructor(db, id) {
    this._db = db;
    this._id = id;
    this._writes = [];
  }
  async get(target) {
    if (target instanceof DocumentReference) return this._db._getDoc(target, this._id);
    if (target instanceof Query) return this._db._runQuery(target, this._id);
    throw new TypeError('tx.get은 문서나 쿼리만 받는다');
  }
  set(ref, data, options = {}) {
    this._writes.push(this._db._setWrite(ref, data, options));
    return this;
  }
  delete(ref) {
    this._writes.push({ delete: ref.name });
    return this;
  }
}

/* ── Firestore ──────────────────────────────────────────────────────── */

export class RestFirestore {
  /**
   * @param {object} opts
   * @param {string} opts.projectId
   * @param {() => Promise<string>} opts.token 접근 토큰(`serviceAccount.js createTokenSource().token`).
   * @param {typeof fetch} [opts.fetchImpl]
   */
  constructor({ projectId, token, fetchImpl = globalThis.fetch }) {
    if (!projectId) throw new TypeError('projectId 필요');
    this.projectId = projectId;
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this._token = token;
    this._fetch = fetchImpl;
  }

  collection(path) {
    return new CollectionReference(this, parsePath(path));
  }
  doc(path) {
    return new DocumentReference(this, parsePath(path));
  }
  batch() {
    return new WriteBatch(this);
  }

  async getAll(...refs) {
    if (refs.length === 0) return [];
    const body = await this._request('POST', `${this.root}:batchGet`, { documents: refs.map((r) => r.name) }, 'batchGet');
    const byName = new Map();
    for (const row of Array.isArray(body) ? body : []) {
      if (row.found) byName.set(row.found.name, row.found.fields ?? {});
      else if (row.missing) byName.set(row.missing, null);
    }
    return refs.map((ref) => new DocumentSnapshot(ref, byName.get(ref.name) ?? null));
  }

  async runTransaction(fn) {
    let lastError;
    for (let attempt = 0; attempt < TX_ATTEMPTS; attempt += 1) {
      const begun = await this._request('POST', `${this.root}:beginTransaction`, {}, 'beginTransaction');
      const tx = new Transaction(this, begun.transaction);
      let result;
      try {
        result = await fn(tx);
      } catch (error) {
        await this._request('POST', `${this.root}:rollback`, { transaction: tx._id }, 'rollback').catch(() => {});
        throw error;
      }
      try {
        await this._request('POST', `${this.root}:commit`, { writes: tx._writes, transaction: tx._id }, 'commit');
        return result;
      } catch (error) {
        // 🔴 경합(ABORTED, HTTP 409)만 다시 한다 — 그 밖의 실패는 바로 올린다.
        if (!(error instanceof FirestoreRestError) || error.status !== 409) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  /** 문서와 그 아래 모든 하위 컬렉션 문서를 지운다. 없는 문서여도 하위는 지운다(admin과 같다). */
  async recursiveDelete(ref) {
    const names = [];
    const collect = async (docRef) => {
      let pageToken = '';
      do {
        const body = await this._request('POST', `${docRef.name}:listCollectionIds`, { pageSize: 100, pageToken }, 'listCollectionIds');
        for (const id of body?.collectionIds ?? []) {
          for (const child of await docRef.collection(id).listDocuments()) await collect(child);
        }
        pageToken = body?.nextPageToken ?? '';
      } while (pageToken);
      names.push(docRef.name);
    };
    await collect(ref);
    for (let i = 0; i < names.length; i += COMMIT_CHUNK) {
      await this._commit(names.slice(i, i + COMMIT_CHUNK).map((name) => ({ delete: name })));
    }
  }

  /* 내부 */

  _refFromName(name) {
    const prefix = `${this.root}/`;
    return new DocumentReference(this, parsePath(name.startsWith(prefix) ? name.slice(prefix.length) : name));
  }

  _setWrite(ref, data, options) {
    const merge = options?.merge === true;
    const { fields, mask, transforms } = splitWrite(data, merge);
    const write = { update: { name: ref.name, fields } };
    if (merge) write.updateMask = { fieldPaths: mask };
    if (transforms.length) write.updateTransforms = transforms;
    return write;
  }

  async _commit(writes) {
    await this._request('POST', `${this.root}:commit`, { writes }, 'commit');
  }

  async _getDoc(ref, transaction) {
    const qs = transaction ? `?${new URLSearchParams({ transaction })}` : '';
    try {
      const body = await this._request('GET', `${ref.name}${qs}`, null, 'get');
      return new DocumentSnapshot(ref, body?.fields ?? {});
    } catch (error) {
      if (error instanceof FirestoreRestError && error.status === 404) return new DocumentSnapshot(ref, null);
      throw error;
    }
  }

  async _runQuery(query, transaction) {
    const payload = { structuredQuery: query._body() };
    if (transaction) payload.transaction = transaction;
    const rows = await this._request('POST', `${query._parentName()}:runQuery`, payload, 'runQuery');
    const docs = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row.document) docs.push(new DocumentSnapshot(this._refFromName(row.document.name), row.document.fields ?? {}));
    }
    return new QuerySnapshot(docs);
  }

  async _request(method, path, body, where) {
    const token = await this._token();
    const response = await this._fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new FirestoreRestError(response.status, err?.error?.status ?? '', where);
    }
    return response.status === 204 ? null : response.json();
  }
}
