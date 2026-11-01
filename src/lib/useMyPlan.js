/**
 * 내 요금제 훅 — 로고 옆 배지(2026-11-01 사용자 결정 「로고 옆 배지로」). 사이드패널·설정 페이지가 같이 쓴다.
 *
 * 🔴 유료화 전(`FEATURES.billing` 꺼짐)에는 묻지도 않는다 — 요금제 문구를 숨긴 것과 같은 이유(「숨기고 올림」).
 * 열 때·다시 보일 때(결제 탭에서 돌아옴)·로그인 상태가 바뀔 때 다시 묻는다. 실패는 `null`(배지 없음).
 */
import { useEffect, useState } from 'react';
import { FEATURES } from '../config.js';
import { getMyPlan } from './billingClient.js';
import { STORAGE_KEYS } from './storage.js';

export function useMyPlan() {
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    if (!FEATURES.billing) return undefined;
    let cancelled = false;
    const refresh = () => {
      getMyPlan().then((next) => {
        if (!cancelled) setPlan(next);
      });
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onStorage = (changes, area) => {
      if (area === 'local' && changes[STORAGE_KEYS.AUTH]) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    globalThis.chrome?.storage?.onChanged?.addListener(onStorage);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      globalThis.chrome?.storage?.onChanged?.removeListener(onStorage);
    };
  }, []);
  return plan;
}
