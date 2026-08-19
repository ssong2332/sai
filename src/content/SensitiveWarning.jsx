/**
 * 민감정보 감지 경고 팝업 (S15 / Spec 필수 11).
 *
 * 🔴 이 팝업이 떠 있는 동안 LLM 호출은 **일어나지 않았다.** 전송 전에 막는 것이 이 기능의 전부다.
 * 🔴 감지된 **값을 화면에 다시 띄우지 않는다** — 종류와 건수만 보여준다. 값을 되비추면
 *    스크린 공유·녹화 중에 그대로 새어 나간다.
 */
export default function SensitiveWarning({ summary, maskedPreview, mode = 'compose', onSendMasked, onCancel }) {
  const actionLabel = mode === 'decode' ? '가리고 해독' : '가리고 교정';
  return (
    <div className="sai-popup sai-popup-narrow" role="alertdialog" aria-label="민감정보 감지">
      <div className="sai-popup-head">
        <span className="sai-brand">
          <span className="sai-mark sai-mark-alert" aria-hidden="true">
            !
          </span>
          <span className="sai-brand-name">S·AI</span>
          <span className="sai-badge sai-badge-alert">전송 차단됨</span>
        </span>
        <button type="button" className="sai-close" onClick={onCancel} aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="sai-vent-body">
        <p className="sai-vent-title">민감한 정보가 있어 AI로 보내지 않았어요</p>
        <p className="sai-vent-desc">
          감지: <b>{summary}</b>
          <br />
          그대로 진행하려면 아래처럼 <code>[REDACTED]</code>로 가린 뒤 보냅니다.
        </p>

        {/* 마스킹된 결과만 보여준다 — 원래 값은 이 화면 어디에도 없다. */}
        <pre className="sai-masked-preview">{maskedPreview}</pre>

        <div className="sai-vent-actions">
          <button type="button" className="sai-button sai-button-quiet" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="sai-button sai-button-primary" onClick={onSendMasked}>
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
