/**
 * 가짜 `chrome.*` — 하네스 전용. 🔴 `main.jsx`에서 **가장 먼저** import한다.
 * 저장은 메모리에만 한다. 네트워크·서버 호출은 없다.
 */
const memory = {
  'sai.backTranslation': true,
  'sai.highlightHints': true,
};

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
        Object.assign(memory, values);
      },
      async remove(key) {
        delete memory[key];
      },
      async clear() {},
    },
    sync: {
      async get() {
        return {};
      },
      async set() {},
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: {
    id: 'harness',
    async sendMessage() {
      return {};
    },
    onMessage: { addListener() {}, removeListener() {} },
    getURL: (path) => path,
  },
};
