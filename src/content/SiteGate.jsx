import { useEffect, useState } from 'react';
import { evaluateSiteGate, getSiteGateSettings, SITE_GATE_KEYS } from '../lib/siteGate.js';

/**
 * 사이트별 켜고 끄기 관문 (2026-10-25) — 꺼진 사이트에서는 **저절로 뜨는 사이 버튼만** 숨긴다.
 *
 * 판정은 `src/lib/siteGate.js` `evaluateSiteGate` 한 곳(차단 목록 > 꺼 둔 통합 > 켜짐). 여기는 읽고 따를 뿐이다.
 * 오버레이는 언제나 그린다 — 단축키 메시지(`chrome.runtime.onMessage`)를 받는 곳이 오버레이라서다.
 *
 * | 상태 | `autoButton` | 사이 버튼(선택 시 자동) | 단축키 Alt+D·Alt+X |
 * |---|---|---|---|
 * | 저장값을 읽기 전 | false | 숨김 — 꺼 둔 사이트에서 잠깐 비쳤다 사라지지 않게 | 동작 |
 * | 꺼짐 | false | 숨김 | **동작** — 사용자가 직접 부른 것(2026-10-25 사용자 결정, DeepL과 같다) |
 * | 켜짐 · 읽기 실패(고아 컨텍스트 등) | true | 보임 — 읽기 실패는 이 기능 이전 동작으로 둔다 | 동작 |
 * 🔴 설정 페이지에서 바꾸면 `chrome.storage.onChanged`로 **새로고침 없이** 따라간다.
 * 🔴 페이지 호스트는 비교에만 쓴다 — 저장하거나 어디로 보내지 않는다.
 *
 * @param {{children: (gate: {autoButton: boolean}) => import('react').ReactNode, hostname?: string}} props
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

    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) {
      return () => {
        cancelled = true;
      };
    }
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

  return children({ autoButton: enabled === true });
}
