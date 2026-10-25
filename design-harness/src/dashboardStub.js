/**
 * 가짜 `chrome.*` + 가짜 Firestore — 확장 대시보드 하네스 전용 (2026-10-25, 0.1.21). 🔴 진입점에서 **가장 먼저** import한다.
 *
 * - 저장은 메모리에만. 팀·지표는 전부 합성(예시 데이터 생성기 `demoData.js`)이다 — 실재하는 팀 아님.
 * - Firestore `:batchGet`만 흉내 낸다 — 요청받은 문서 수를 `window.__harnessReads`에 센다(읽기 수 확인용).
 *   그 밖의 외부 요청은 즉시 실패한다.
 * - `?theme=dark` · `?state=login|noteam|noview|error` · `?team=<id>`.
 * 🔴 화면 검토용이다. 실브라우저 unpacked 확인을 대신하지 않는다.
 */
import { demoTeams } from '../../src/dashboard/seam/demoData.js';

const params = new URLSearchParams(location.search);
const state = params.get('state');

const demo = demoTeams(new Date());
const data = { fe: demo[0].byDate, sg: demo[1].byDate, qa: demo[2].byDate, empty: {} };

const memory = {
  'sai.theme': params.get('theme') === 'dark' ? 'dark' : 'light',
  'sai.teams':
    state === 'noteam'
      ? []
      : state === 'noview'
        ? [{ teamId: 'fe', name: '프론트엔드팀', role: 'member', canViewDashboard: false }]
        : [
            { teamId: 'fe', name: '프론트엔드팀', role: 'owner' },
            { teamId: 'sg', name: '싱가포르 협업', role: 'member', canViewDashboard: true },
            { teamId: 'qa', name: 'QA팀', role: 'member', canViewDashboard: true },
            { teamId: 'empty', name: '새로 만든 팀', role: 'owner' },
            { teamId: 'hidden', name: '열람 권한 없는 팀', role: 'member', canViewDashboard: false },
          ],
  'sai.teams.active': 'fe',
};
if (state !== 'login') {
  memory['sai.auth'] = { uid: 'harness', email: 'harness@example.com', idToken: 'harness-token', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 };
}

const listeners = new Set();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (key == null) return { ...memory };
        const keys = Array.isArray(key) ? key : typeof key === 'string' ? [key] : Object.keys(key);
        const out = {};
        for (const k of keys) if (k in memory) out[k] = memory[k];
        return out;
      },
      async set(values) {
        const changes = {};
        for (const [k, v] of Object.entries(values)) changes[k] = { oldValue: memory[k], newValue: v };
        Object.assign(memory, values);
        for (const fn of listeners) fn(changes, 'local');
      },
      async remove(key) { delete memory[key]; },
      async clear() {},
    },
    sync: { async get() { return {}; }, async set() {} },
    onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
  },
  runtime: { id: 'harness', getURL: (p) => `/${p}`, async sendMessage() { return {}; }, onMessage: { addListener() {}, removeListener() {} } },
  identity: {},
};

const toFields = (key, counts) => {
  const fields = { dateKey: { stringValue: key } };
  for (const [k, v] of Object.entries(counts)) fields[k] = { integerValue: String(v) };
  return fields;
};

window.__harnessReads = { docs: 0, requests: 0, log: [] };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('firestore.googleapis.com') && u.endsWith(':batchGet')) {
    const { documents } = JSON.parse(init.body);
    window.__harnessReads.docs += documents.length;
    window.__harnessReads.requests += 1;
    window.__harnessReads.log.push(documents.length);
    await new Promise((r) => setTimeout(r, 250));
    if (state === 'error') return { ok: false, status: 503, json: async () => ({}) };
    const rows = documents.map((name) => {
      const [, teamId, key] = /frictionCounts\/(.+)_(\d{4}-\d{2}-\d{2})$/.exec(name) ?? [];
      const counts = data[teamId]?.[key];
      return counts ? { found: { name, fields: toFields(key, counts) } } : { missing: name };
    });
    return { ok: true, status: 200, json: async () => rows };
  }
  if (u.startsWith('http') && !u.startsWith(location.origin)) throw new TypeError('하네스: 외부 요청 차단');
  return realFetch(url, init);
};
