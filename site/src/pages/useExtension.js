import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, createExtensionClient, describeError, interpretHello } from '../bridge.js';
import { createFakeSend } from '../fakeBridge.js';

/**
 * 설정 화면의 연결·저장 상태.
 * 🔴 demo=false에서 연결이 안 되면 **연결 안 됨으로 남는다** — 데모로 바꾸지 않는다.
 * 🔴 창으로 돌아오면(focus·visibilitychange) 다시 읽는다 — 확장 사이드패널에서 바꾼 값이 남아
 *    있으면 이 페이지가 옛 값을 덮어쓸 수 있다.
 */
export function useExtension({ demo }) {
  const client = useMemo(() => (demo ? createClient(createFakeSend()) : createExtensionClient()), [demo]);
  const [status, setStatus] = useState({ state: 'checking' });
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  /** 컨트롤별 저장 상태: { [key]: {state:'saving'|'saved'|'error', message?} } */
  const [saves, setSaves] = useState({});
  const timers = useRef({});
  const busy = useRef(false);

  const connect = useCallback(
    async ({ quiet = false } = {}) => {
      if (busy.current) return;
      busy.current = true;
      if (!quiet) setStatus({ state: 'checking' });
      try {
        const hello = interpretHello(await client.hello());
        setStatus(hello);
        if (hello.state !== 'connected') {
          setSettings(null);
          return;
        }
        const got = await client.get();
        if (got.ok && got.settings) {
          setSettings(got.settings);
          setLoadError(null);
        } else {
          setLoadError(describeError(got.error));
        }
      } finally {
        busy.current = false;
      }
    },
    [client],
  );

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    const onFocus = () => connect({ quiet: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') connect({ quiet: true });
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connect]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const mark = useCallback((key, value) => {
    clearTimeout(timers.current[key]);
    setSaves((prev) => ({ ...prev, [key]: value }));
    if (value?.state === 'saved') {
      timers.current[key] = setTimeout(() => {
        setSaves((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 2400);
    }
  }, []);

  /** 저장 한 번 — `apply(result)`가 성공 결과를 settings에 반영한다. */
  const run = useCallback(
    async (key, request, apply) => {
      mark(key, { state: 'saving' });
      const result = await request();
      if (result.ok) {
        setSettings((prev) => (prev ? apply(prev, result) : prev));
        mark(key, { state: 'saved' });
        return true;
      }
      mark(key, { state: 'error', message: describeError(result.error) });
      return false;
    },
    [mark],
  );

  const actions = useMemo(
    () => ({
      set: (section, patch, key) =>
        run(key ?? `${section}.${Object.keys(patch).join(',')}`, () => client.set(section, patch), (_prev, r) =>
          r.settings ?? _prev,
        ),
      addGlossary: (entry) =>
        run('glossary.add', () => client.addGlossary(entry), (prev, r) => ({ ...prev, glossary: r.glossary ?? prev.glossary })),
      updateGlossary: (id, patch) =>
        run(`glossary.${id}`, () => client.updateGlossary(id, patch), (prev, r) => ({
          ...prev,
          glossary: r.glossary ?? prev.glossary,
        })),
      removeGlossary: (id) =>
        run(`glossary.${id}`, () => client.removeGlossary(id), (prev, r) => ({ ...prev, glossary: r.glossary ?? prev.glossary })),
      removeLearned: (categoryId) =>
        run(`learned.${categoryId}`, () => client.removeLearned(categoryId), (prev, r) => ({
          ...prev,
          learned: r.learned ?? prev.learned,
          learnedServer: r.server ?? null,
        })),
      clearLearned: () =>
        run('learned.all', () => client.clearLearned(), (prev, r) => ({
          ...prev,
          learned: r.learned ?? prev.learned,
          learnedServer: r.server ?? null,
        })),
    }),
    [client, run],
  );

  return { status, settings, loadError, saves, actions, retry: () => connect() };
}
