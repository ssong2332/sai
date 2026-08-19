/**
 * 하소연 감지 제안 팝업 (S09 / Spec 필수 4) — [DS] 프로토타입 "하소연 감지 팝업" 이식.
 *
 * 🔴 이 팝업은 `detectedIntent === 'venting'`일 때만 뜬다. 감정 신호가 낮은 입력에
 *    "티켓으로 바꿀까요?"를 들이미는 것이 이 기능의 가장 흔한 실패다
 *    (오탐 방지 — Lessons 자산 3 / 구 AC-058). 판정은 서버가 하고, 여기서 재판정하지 않는다.
 * 🔴 감정을 **삭제**하는 기능이 아니다. 감정은 '우려 수준' 메타데이터로 보존된다 —
 *    문구가 그 사실을 사용자에게 먼저 알린다.
 */
import SaiMark from '../assets/SaiMark.jsx';

export default function VentingPrompt({ result, onRefineOnly, onConvert, onClose }) {
  return (
    <div className="sai-popup sai-popup-narrow" role="dialog" aria-label="사이 감정 표현 감지">
      <div className="sai-popup-head">
        <span className="sai-brand">
          <SaiMark size={28} />
          <span className="sai-brand-name">S·AI</span>
          <span className="sai-badge">감정 표현 감지</span>
        </span>
        <button type="button" className="sai-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="sai-vent-body">
        <p className="sai-vent-title">감정이 담긴 메시지예요 — 티켓으로 변환할까요?</p>
        <p className="sai-vent-desc">
          [문제점 / 영향 / 요청사항] 구조로 정리하고, 감정 톤은 &lsquo;우려 수준&rsquo;
          메타데이터로 보존해요.
        </p>

        {/* 판정 근거를 감추지 않는다 — 왜 하소연으로 봤는지 사용자가 확인할 수 있어야 한다. */}
        {result?.intentEvidence && (
          <p className="sai-vent-evidence">
            근거: <q>{result.intentEvidence}</q>
          </p>
        )}

        <div className="sai-vent-actions">
          <button type="button" className="sai-button sai-button-quiet" onClick={onRefineOnly}>
            그대로 톤만 교정
          </button>
          <button type="button" className="sai-button sai-button-primary" onClick={onConvert}>
            티켓으로 변환
          </button>
        </div>
      </div>
    </div>
  );
}
