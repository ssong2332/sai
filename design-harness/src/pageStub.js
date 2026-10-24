/**
 * 가짜 `chrome.*` — 사이드패널·결정 화면 하네스 전용. 🔴 각 페이지 진입점에서 **가장 먼저** import한다.
 *
 * - 저장은 메모리에만 한다. 아래 목업은 전부 합성이다(인물·회사 실재하지 않음).
 * - 🔴 네트워크를 막는다: 외부 오리진 `fetch`는 즉시 실패한다(로그인·팀 동기화가 서버를 부르지 않게).
 * - `?theme=dark`면 저장된 테마를 다크로 둔다(사이드패널이 `sai.theme`을 읽어 `data-theme`를 붙인다).
 */
const params = new URLSearchParams(location.search);
const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const dateKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const iso = (hoursFromNow) => new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();

const memory = {
  'sai.theme': params.get('theme') === 'dark' ? 'dark' : 'light',
  'sai.backTranslation': true,
  'sai.highlightHints': true,
  'sai.refineReasoning': false,
  'sai.snippetInsertMode': 'replace',
  'sai.threadContext': false,
  'sai.onboarding':
    params.get('onboarding') === 'new'
      ? { language: null, partnerRegion: null, tone: null, completedAt: null }
      : { language: 'ko', partnerRegion: 'english', tone: 'direct', completedAt: iso(-48) },
  'sai.usage.today': { dateKey, refined: 4, decoded: 2, scheduled: 1, blockedSensitive: 1, blockedOffHours: 0 },
  'sai.recipients': [
    { id: 'r1', name: 'Miguel', timeZone: 'Europe/Lisbon', countryCode: 'PT', language: 'en', tagIds: [], teamId: 'personal' },
    { id: 'r2', name: 'Yuki', timeZone: 'Asia/Tokyo', countryCode: 'JP', language: 'ja', tagIds: [], teamId: 'personal' },
  ],
  'sai.recipients.selected': 'r1',
  'sai.glossary.personal': [
    { id: 'g1', sourceText: '배포', targetText: 'deploy', keepSource: false, language: 'en' },
    { id: 'g2', sourceText: '스테이징', targetText: 'staging', keepSource: false, language: 'en' },
    { id: 'g3', sourceText: 'v2.4', targetText: null, keepSource: true, language: null },
  ],
  'sai.snippets': [
    { id: 's1', text: 'Could you take a look when you have a moment? No rush before Thursday.', language: 'en', createdAt: iso(-30) },
    { id: 's2', text: "Thanks for the quick turnaround — I'll merge once CI is green.", language: 'en', createdAt: iso(-5) },
  ],
  'sai.reservations': [
    { id: 'v1', text: 'We need to finish the v2.4 deploy by Friday 3 PM.', recipientName: 'Miguel', sendAtLabel: '내일 (금) 09:00', sendAtISO: iso(14), createdAt: iso(-1) },
  ],
  'sai.profile': { situationId: null, collabStyleId: 'direct' },
  'sai.profile.learned': { 'deadline-explicit': 6, 'fewer-apologies': 3, shorter: 2 },
  'sai.identity': { displayName: '박하늘', jobTitle: '백엔드 엔지니어' },
  'sai.decisionsConsent': true,
  'sai.decisionLogs': [
    {
      id: 'd1',
      title: 'v2.4 배포 일정 조율',
      sourceLabel: 'app.slack.com',
      savedAt: iso(-3),
      decisionCount: 3,
      unresolvedCount: 1,
      decisions: [
        { decision: '금요일 15:00까지 v2.4 배포', owner: 'Miguel', dueDate: '금요일 15:00', authorityStatus: '확정', authorityEvidence: '"Let\'s lock Friday 3 PM."' },
        { decision: '스테이징 점검 1회 추가', owner: '박하늘', dueDate: null, authorityStatus: '검토 중', authorityEvidence: null },
        { decision: '릴리스 노트 공유 범위', owner: null, dueDate: null, authorityStatus: '불명', authorityEvidence: null },
      ],
    },
  ],
};

const listeners = new Set();

function pick(key) {
  if (key == null) return { ...memory };
  if (Array.isArray(key)) return Object.fromEntries(key.filter((k) => k in memory).map((k) => [k, memory[k]]));
  if (typeof key === 'string') return key in memory ? { [key]: memory[key] } : {};
  return Object.fromEntries(Object.entries(key).map(([k, d]) => [k, k in memory ? memory[k] : d]));
}

function area() {
  return {
    async get(key) {
      return structuredClone(pick(key));
    },
    async set(values) {
      const changes = {};
      for (const [k, v] of Object.entries(values)) {
        changes[k] = { oldValue: memory[k], newValue: v };
        memory[k] = structuredClone(v);
      }
      listeners.forEach((fn) => fn(changes, 'local'));
    },
    async remove(key) {
      for (const k of Array.isArray(key) ? key : [key]) delete memory[k];
    },
    async clear() {},
  };
}

globalThis.chrome = {
  storage: {
    local: area(),
    sync: { async get() { return {}; }, async set() {}, async remove() {} },
    onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
  },
  runtime: {
    id: 'harness',
    lastError: undefined,
    async sendMessage() {
      return {};
    },
    onMessage: { addListener() {}, removeListener() {} },
    getURL: (path) => `/${String(path).replace(/^\//, '')}`,
  },
  tabs: { async create() {} },
  identity: {
    launchWebAuthFlow(_opts, cb) {
      cb?.(undefined);
    },
    getAuthToken(_opts, cb) {
      cb?.(undefined);
    },
  },
};

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? '';
  if (/^https?:\/\//.test(url) && !url.startsWith(location.origin)) {
    return Promise.reject(new TypeError('harness: network blocked'));
  }
  return realFetch(input, init);
};
