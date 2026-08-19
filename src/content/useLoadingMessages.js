import { useEffect, useState } from 'react';

/**
 * 로딩 중 상태 문구를 순환시킨다 — 애니메이션 마크 하나만 계속 도는 것보다, 실제로 뭘 하고
 * 있는지 알려주는 문구가 바뀌는 편이 "반복되는 느낌"을 줄인다(2026-08-13 사용자 요청).
 *
 * 🔴 실제 진행 단계와 무관한 **연출용 문구**다 — 백엔드는 단일 호출(Spec §6-3)이라 진짜 단계별
 *    진행률을 알 수 없다. 그래서 각 문구가 "거짓 진행 상황"으로 읽히지 않게, 결과가 실제로
 *    어떤 축들로 이뤄지는지(긴급도·역번역·용어집 등)를 그대로 나열하는 수준으로만 쓴다.
 *
 * @param {boolean} active 로딩 중일 때만 순환한다. false면 항상 첫 문구로 멈춰 있는다.
 * @param {readonly string[]} messages 모듈 최상단 상수로 넘긴다 — 매 렌더 새 배열을 만들면
 *   effect가 매번 재시작된다.
 * @param {number} [intervalMs]
 */
export function useLoadingMessages(active, messages, intervalMs = 1400) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return undefined;
    }
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, messages, intervalMs]);

  return messages[index];
}
