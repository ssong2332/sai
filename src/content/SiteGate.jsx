import { useEffect, useState } from 'react';
import { evaluateSiteGate, getSiteGateSettings, SITE_GATE_KEYS } from '../lib/siteGate.js';

/**
 * 사이트별 켜고 끄기 관문 (2026-10-25) — 꺼진 사이트에서는 오버레이를 **그리지 않는다.**
 *
 * 판정은 `src/lib/siteGate.js` `evaluateSiteGate` 한 곳(차단 목록 > 꺼 둔 통합 > 켜짐). 여기는 읽고 따를 뿐이다.
 *
 * | 상태 | 그리는 것 |
 * |---|---|
 * | 저장값을 읽기 전 | 아무것도 — 꺼 둔 사이트에서 버튼이 잠깐 비쳤다 사라지지 않게 |
 * | 꺼짐 | 아무것도 — 사이 버튼·팝업·단축키(Alt+D·Alt+X) 모두 이 페이지에서는 반응하지 않는다 |
 * | 켜짐 · 읽기 실패(고아 컨텍스트 등) | `children` — 읽기 실패는 이 기능 이전 동작(항상 켜짐)으로 둔다 |
 * 🔴 설정 페이지에서 바꾸면 `chrome.storage.onChanged`로 **새로고침 없이** 따라간다.
 * 🔴 페이지 호스트는 비교에만 쓴다 — 저장하거나 어디로 보내지 않는다.
 */
export default function SiteGate({ children, hostname = globalThis.location?.hostname ?? '' }) {
  const [enabled, setEnabled] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      getSiteGateSettings()
        .then((settings) => {
          if (!cancelled) setEnabled(evaluateSiteGate(hostname, settings).enabled);
        })
        .catch(() => {
          if (!cancelled) setEnabled(true);
        });
    read();

    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return () => {
      cancelled = true;
    };
    const onChanged = (changes, area) => {
      if (area !== 'local') return;
      if (SITE_GATE_KEYS.some((key) => key in changes)) read();
    };
    try {
      chrome.storage.onChanged.addListener(onChanged);
    } catch {
      /* 고아 컨텍스트 — 처음 읽은 값을 그대로 쓴다. */
    }
    return () => {
      cancelled = true;
      try {
        chrome.storage.onChanged.removeListener(onChanged);
      } catch {
        /* 무시 */
      }
    };
  }, [hostname]);

  return enabled ? children : null;
}
