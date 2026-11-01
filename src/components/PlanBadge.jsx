/**
 * 요금제 배지 — 로고 옆 작은 알약(2026-11-01 사용자 결정 「로고 옆 배지로」). 사이드패널·설정 페이지 헤더.
 * 이름의 일부로 읽히지 않게 작게 떨어뜨리고, 누르는 것이 아니라 표시만. `pro`·`team`이 아니면 아무것도 그리지 않는다.
 * 🔴 확장 페이지 전용 — 콘텐츠 팝업(Shadow DOM)에는 이 CSS가 들어가지 않는다.
 */
import { planBadgeLabel } from '../lib/billingClient.js';
import './planBadge.css';

export default function PlanBadge({ plan }) {
  const label = planBadgeLabel(plan);
  if (!label) return null;
  return (
    <span className={`plan-badge plan-badge-${plan}`} title={plan === 'team' ? '팀 요금제 사용 중' : 'Pro 요금제 사용 중'}>
      {label}
    </span>
  );
}
