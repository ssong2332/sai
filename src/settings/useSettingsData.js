import { useCallback, useEffect, useRef, useState } from 'react';
import { readDisplaySettings } from '../lib/displaySettings.js';
import { getOnboarding } from '../lib/onboarding.js';
import { getProfile, getLearnedCounts } from '../lib/profile.js';
import { getIdentity } from '../lib/identity.js';
import { listPersonalGlossary } from '../lib/glossary.js';
import { getSiteGateSettings } from '../lib/siteGate.js';
import { readLocalDataSummary } from '../lib/localData.js';
import { getSession } from '../lib/authClient.js';

/**
 * 설정 페이지가 보여 줄 값 전부 — `src/lib/*`를 **직접** 읽는다(웹 브리지를 거치지 않는다).
 *
 * 🔴 **다른 화면에서 바꾼 값을 따라간다.** 사이드패널·페이지 팝업이 같은 저장소를 쓰므로
 *    `chrome.storage.onChanged`(local)가 오면 다시 읽는다. 연달아 오는 변경은 60ms로 묶는다.
 *    탭으로 돌아올 때(visibilitychange)도 다시 읽는다 — 리스너가 없는 환경(미리보기)에서도 낡지 않게.
 * 🔴 `session`은 화면 표시용 로그인 여부뿐이다 — 이메일은 「데이터」 패널에서도 보여 주지 않는다.
 */
async function readAll() {
  const [display, onboarding, profile, identity, learned, glossary, sites, summary, session] = await Promise.all([
    readDisplaySettings(),
    getOnboarding(),
    getProfile(),
    getIdentity(),
    getLearnedCounts(),
    listPersonalGlossary(),
    getSiteGateSettings(),
    readLocalDataSummary(),
    getSession().catch(() => null),
  ]);
  return {
    display,
    onboarding: onboarding ?? {},
    profile: profile ?? {},
    identity: identity ?? { displayName: '', jobTitle: '' },
    learned: learned ?? {},
    glossary,
    sites,
    summary,
    signedIn: Boolean(session),
  };
}

export function useSettingsData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const timer = useRef(null);

  const reload = useCallback(async () => {
    try {
      setData(await readAll());
      setError(false);
    } catch {
      // 🔴 사유를 화면·로그에 싣지 않는다 — 저장소 오류 문구에 무엇이 섞일지 모른다.
      setError(true);
    }
  }, []);

  useEffect(() => {
    reload();
    const schedule = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(reload, 60);
    };
    const onChanged = (_changes, area) => {
      if (area === 'local') schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    const storage = typeof chrome !== 'undefined' ? chrome?.storage?.onChanged : null;
    storage?.addListener(onChanged);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer.current);
      storage?.removeListener(onChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  return { data, error, reload };
}
