/**
 * 내 요금제 훅 — 로고 옆 배지(2026-11-01 사용자 결정 「로고 옆 배지로」) · 기능 숨김(2026-11-05 「무료 2단계」).
 *
 * 🔴 유료화 전(`FEATURES.billing` 꺼짐)에는 묻지도 않는다 — 요금제 문구를 숨긴 것과 같은 이유(「숨기고 올림」).
 * 열 때·다시 보일 때(결제 탭에서 돌아옴)·로그인 상태가 바뀔 때 다시 묻고 기기에 저장한다(`planCache.js`).
 * `useMyPlan`은 배지용(모르면 `null`), `usePlanFeatures`는 숨김용(모르면 무료 표).
 */
import { useEffect, useState } from 'react';
import { FEATURES } from '../config.js';
import { featuresFromCache, getCachedPlan, refreshPlan } from './planCache.js';
import { STORAGE_KEYS } from './storage.js';

/** 저장된 요금제를 읽고, 바뀌면 따라간다. `refresh`면 열 때·다시 보일 때·로그인이 바뀔 때 서버에 다시 묻는다. */
function usePlanState({ refresh }) {
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    if (!FEATURES.billing) return undefined;
    let cancelled = false;
    const read = () => {
      getCachedPlan().then((next) => {
        if (!cancelled) setPlan(next);
      });
    };
    const ask = () => {
      refreshPlan().then(read);
    };
    read();
    if (refresh) ask();
    const onVisible = () => {
      if (document.visibilityState === 'visible') (refresh ? ask : read)();
    };
    const onStorage = (changes, area) => {
      if (area !== 'local') return;
      if (refresh && changes[STORAGE_KEYS.AUTH]) ask();
      else if (changes[STORAGE_KEYS.PLAN]) read();
    };
    document.addEventListener('visibilitychange', onVisible);
    globalThis.chrome?.storage?.onChanged?.addListener(onStorage);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      globalThis.chrome?.storage?.onChanged?.removeListener(onStorage);
    };
  }, [refresh]);
  return plan;
}

/** 배지·요금제 패널 — 사이드패널·설정 페이지(서버에 다시 묻는다). */
export function useMyPlan() {
  return usePlanState({ refresh: true });
}

/**
 * 기능 한도(`PLAN_FEATURES`) — 사이드패널·설정·콘텐츠 팝업. 콘텐츠 스크립트는 서버를 직접 부르지 않고 저장값만 읽는다
 * (`refresh: false` — 페이지마다 서버 호출이 생기지 않게. 갱신은 백그라운드·사이드패널 몫).
 */
export function usePlanFeatures({ refresh = false } = {}) {
  return featuresFromCache(usePlanState({ refresh }));
}
