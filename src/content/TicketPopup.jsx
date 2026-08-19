/**
 * 티켓 변환 팝업 (S09 / Spec 필수 4) — [DS] 프로토타입 "티켓 변환 팝업" 이식.
 *
 * 3단 구조 [문제점 / 영향 / 요청사항] + 감정은 '우려 수준' **메타데이터로 보존**한다.
 *
 * 🔴 우려 수준은 서술형으로만 표시한다 — 숫자 점수 표기는 Spec 필수 9 G1/G2로 전면 금지다.
 * 🔴 근거가 없는 섹션은 지어내지 않고 `"없음"`으로 온다(`schema.js`가 그렇게 정규화한다).
 *    화면은 그 값을 그대로 보여준다.
 */
import SaiMark from '../assets/SaiMark.jsx';

const SECTIONS = [
  { key: 'problem', label: '문제점' },
  { key: 'impact', label: '영향' },
  { key: 'request', label: '요청사항' },
];

/**
 * 입력창에 넣을 3단 텍스트를 조립한다. 화면 표시와 실제 적용 텍스트가 갈리지 않도록
 * 여기 한 곳에서만 만든다.
 */
export function formatTicketText(ticket) {
  return [
    `[Issue] ${ticket.problem}`,
    `[Impact] ${ticket.impact}`,
    `[Request] ${ticket.request}`,
  ].join('\n');
}

export default function TicketPopup({ result, onBack, onApply, onClose }) {
  const ticket = result?.ticket;
  if (!ticket) return null;

  return (
    <div className="sai-popup" role="dialog" aria-label="사이 티켓 변환">
      <div className="sai-popup-head">
        <span className="sai-brand">
          <SaiMark size={28} />
          <span className="sai-brand-name">S·AI</span>
          <span className="sai-badge">티켓 변환</span>
        </span>
        <button type="button" className="sai-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="sai-ticket">
        {SECTIONS.map((section) => (
          <div key={section.key} className="sai-ticket-row">
            <span className="sai-ticket-label">{section.label}</span>
            <span className="sai-ticket-value">{ticket[section.key]}</span>
          </div>
        ))}
      </div>

      {/* Spec 필수 4 — 감정은 삭제가 아니라 메타데이터로 보존된다.
          🔴 예전엔 헤더 한 줄에 끼워 넣어 **문장이 잘렸다**(2026-08-14 사용자 지적) — 보존이
             목적인 정보를 읽을 수 없게 만들면 보존한 의미가 없다. 3단 아래 전용 줄로 내려
             전문이 줄바꿈되게 했다.
          🔴 3단(문제점/영향/요청사항)과 **같은 행 구조를 쓰지 않는다** — 이건 4번째 항목이
             아니라 메타다. 구분선 아래에 작고 흐리게 둬서 성격 차이를 형태로 보인다.
          🔴 서술형으로만 표시한다 — 숫자 점수는 Spec 필수 9 G1/G2로 전면 금지. */}
      <div className="sai-concern">
        <span className="sai-concern-label">우려 수준</span>
        <span className="sai-concern-text">{ticket.concernLevel}</span>
      </div>

      {/* Spec 필수 3 — 역번역은 티켓에도 붙는다(상대에게 어떻게 읽히는지 확인). */}
      {result.ticketBackTranslation && (
        <div className="sai-back">
          <span className="sai-label">역번역</span>
          <p className="sai-back-text">{result.ticketBackTranslation}</p>
        </div>
      )}

      <div className="sai-popup-foot">
        <button type="button" className="sai-link" onClick={onBack}>
          ← 뒤로
        </button>
        <button type="button" className="sai-button sai-button-primary" onClick={onApply}>
          티켓으로 적용
        </button>
      </div>
    </div>
  );
}
