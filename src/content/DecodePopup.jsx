/**
 * 수신 메시지 해독기 팝업 (S10 / Spec 필수 10, F-11) — [DS] 프로토타입 "수신 해독 팝업" 이식.
 *
 * 4축: 직역 / 실제 의도(문화적 완곡 표현 해독) / 체감 긴급도(표면 vs 실제) / 요구 행동.
 * 예시(Spec 원문): "I have a few minor comments" → 실제 의도: 전면 재작업 요구.
 *
 * 🔴 여기서 긴급도를 재판정하지 않는다 — 서버가 이미 표면/실제 두 값을 줬고, 이 컴포넌트는
 *    그 차이를 시각화만 한다.
 */
import { useState } from 'react';
import SaiMark from '../assets/SaiMark.jsx';
import { useLoadingMessages } from './useLoadingMessages.js';
import { REPLY_INTENTS, REPLY_INTENT_LABELS } from '../core/reply/prompt.js';
import { REPLY_QUESTIONS } from '../core/reply/questions.js';
import { verifyReplyDraft } from '../core/reply/verify.js';
import { copyToClipboard } from './applyText.js';

const URGENCY_ORDER = { LOW: 0, NORMAL: 1, CRITICAL: 2 };
const URGENCY_LABEL = { LOW: 'Low', NORMAL: 'Normal', CRITICAL: 'High' };

/** 로딩 중 순환 문구 — 해독 4축과 대응시켰다(과장 없음). */
const DECODE_LOADING_MESSAGES = [
  '문장을 분석하고 있어요…',
  '문화적 맥락을 확인하고 있어요…',
  '체감 긴급도를 비교하고 있어요…',
  '요구 행동을 정리하고 있어요…',
];

/** 회신 초안 로딩 문구 — 실제로 하는 일만 적는다(과장 없음). */
const REPLY_LOADING_MESSAGES = [
  '회신 방향을 잡고 있어요…',
  '문장을 다듬고 있어요…',
  '지어낸 값이 없는지 보고 있어요…',
];

export default function DecodePopup({
  result,
  loading,
  error,
  onClose,
  sourceText = '',
  onReply,
  replyIntent = null,
  replyResult = null,
  replyLoading = false,
  replyError = '',
  onToast,
  /** S40 — 초안이 옆 패널로 나갔으면 여기서는 방향 줄만 그린다. */
  replySideBySide = false,
  replyAsk = null,
  replyAnswers = {},
  onReplyAnswersChange,
  onReplySubmit,
  onReplySkip,
  replySentAnswers = '',
  replyDraftText = '',
  onReplyDraftTextChange,
  onReplyRefine,
  replyAuto = false,
  onToggleReplyAuto,
}) {
  const loadingText = useLoadingMessages(loading, DECODE_LOADING_MESSAGES);

  return (
    <div className="sai-popup sai-popup-narrow" role="dialog" aria-label="사이 뜻 풀기">
      <div className="sai-popup-head">
        <span className="sai-brand">
          <SaiMark size={28} />
          <span className="sai-brand-name">S·AI</span>
          <span className="sai-badge sai-badge-green">뜻 풀기</span>
        </span>
        <button type="button" className="sai-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="sai-decode-body">
        {loading && (
          <span className="sai-loading">
            {loadingText}
          </span>
        )}
        {!loading && error && <p className="sai-ainote sai-error">{error}</p>}

        {!loading && !error && result && (
          <>
            {result.fallback ? (
              <p className="sai-ainote sai-error">{result.fallbackNotice}</p>
            ) : (
              <>
                {/**
                 * 🔴 **목업임을 반드시 말한다** (Lessons #5 — 폴백을 실제 결과로 오인시키지
                 *    않는다). 교정 팝업에는 이 경고가 있었는데 해독 팝업에는 없어서, 백엔드가
                 *    꺼져 있을 때 사용자가 목업을 실제 분석으로 읽었다(2026-08-14 실측).
                 *    특히 위험한 조합이다: 시드에 없는 입력의 목업은 **원문을 직역 자리에
                 *    그대로 두고 의도 분석은 비운다**. 경고가 없으면 "이 문장은 분석할 게
                 *    없구나"로 읽힌다 — 실제로는 아무것도 분석하지 않은 것이다.
                 */}
                {(result.mock || result.backendUnreachable) && (
                  <p className="sai-decode-mock">
                    {/* 🔴 해요체로 통일 (2026-08-15) — 한 문단에서 「아니에요」와 「않았습니다」가
                        섞여 있었다. 제품 전체가 해요체다. */}
                    목업 응답 — 실제 해석 결과가 아니에요. AI 서버에 연결되지 않았어요.
                  </p>
                )}

                <Section label="직역">
                  <p className="sai-decode-text">{result.literalTranslation}</p>
                </Section>

                {result.actualIntent && (
                  <div className="sai-decode-intent">
                    <div className="sai-decode-intent-label">실제 의도 — 완곡 표현 감지</div>
                    <p className="sai-decode-intent-text">{result.actualIntent}</p>
                    {result.intentEvidence && (
                      <p className="sai-decode-evidence">{result.intentEvidence}</p>
                    )}
                  </div>
                )}

                <UrgencyGap
                  surface={result.surfaceUrgency}
                  actual={result.actualUrgency}
                  gap={result.urgencyGap}
                  reason={result.urgencyReason}
                />

                <Section label="요구 행동">
                  {result.requiredActions.length === 0 ? (
                    <p className="sai-decode-none">특별히 요구되는 행동은 없어 보여요.</p>
                  ) : (
                    <ol className="sai-decode-actions">
                      {result.requiredActions.map((action, index) => (
                        <li key={index}>
                          <span className="sai-decode-action-num">{index + 1}</span>
                          {action}
                        </li>
                      ))}
                    </ol>
                  )}
                </Section>

                {/**
                 * S37 회신 초안 — 판정표(2026-08-14 확정):
                 * | 요구 행동 0건        | 숨김 — 수락/조율/코멘트 셋 다 성립하지 않는다 |
                 * | 목업·백엔드 불통     | 숨김 — 해독을 못 한 상태의 회신은 근거가 없다 |
                 * | 그 외                | 버튼 3개 노출                              |
                 */}
                {onReply && result.requiredActions.length > 0 && !result.mock && !result.backendUnreachable && (
                  <>
                    <ReplyIntentBar
                      recommended={result.recommendedReply}
                      onPick={onReply}
                      intent={replyIntent}
                      askIntent={replyAsk}
                      loading={replyLoading}
                      autoOn={replyAuto}
                      onToggleAuto={onToggleReplyAuto}
                    />
                    {/* 🔴 좁은 창에서만 여기 이어 붙인다 — 넓으면 형제 패널이 같은 것을 그린다. */}
                    {!replySideBySide && (
                      <ReplyPanel
                        askIntent={replyAsk}
                        answers={replyAnswers}
                        onAnswersChange={onReplyAnswersChange}
                        onSubmit={onReplySubmit}
                        onSkip={onReplySkip}
                        result={replyResult}
                        loading={replyLoading}
                        error={replyError}
                        sourceText={sourceText}
                        sentAnswerText={replySentAnswers}
                        onToast={onToast}
                        draftText={replyDraftText}
                        onDraftTextChange={onReplyDraftTextChange}
                        onRefine={onReplyRefine}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/**
         * Spec 필수 5 — 🔴 **해독도 같은 서버로 본문을 보낸다.** 2026-08-15까지 이 안내는
         *    다듬기 팝업에만 있었는데, 사용자 입장에서 「남의 메시지를 붙여 넣는」 해독 쪽이
         *    오히려 더 신경 쓰이는 화면이다. 한쪽에만 있으면 없는 쪽은 저장된다는 뜻으로 읽힌다.
         */}
        {result && !loading && !error && (
          <p className="sai-foot-note sai-decode-zr">Zero Retention — 본문은 저장되지 않아요</p>
        )}
      </div>
    </div>
  );
}

/**
 * 회신 방향 선택 줄 (S37 / S40) — **항상 해독 팝업 안에** 있다.
 *
 * 🔴 초안(질문·결과)은 넓은 창에서 **형제 패널**로 나가지만 이 줄은 남는다. 방향 버튼은 해독
 *    결과(요구 행동·추천)를 보고 고르는 것이라, 해독에서 떼면 무엇을 보고 골랐는지 사라진다.
 */
export function ReplyIntentBar({
  onPick,
  intent,
  askIntent,
  loading,
  recommended,
  autoOn,
  onToggleAuto,
}) {
  return (
    <div className="sai-decode-section sai-reply">
      <div className="sai-reply-head">
        <span className="sai-decode-section-label">회신 초안</span>
        {/* 🔴 무엇이 자동인지 라벨만으로는 알 수 없다 — 켜면 질문 카드가 통째로 사라지는
            설정이라 설명 없이 두면 기능이 없어진 것으로 읽힌다 (2026-08-15 검토). */}
        <label className="sai-reply-auto" title="질문 없이 바로 초안을 만들어요">
          <input type="checkbox" checked={autoOn} onChange={onToggleAuto} />
          자동 모드
        </label>
      </div>
      <p className="sai-reply-hint">
        {autoOn
          ? '질문 없이 바로 초안을 만들어요. 채울 값은 대괄호로 비워 둬요.'
          : '몇 가지 물어보고 빈칸이 적은 초안을 만들어요.'}
      </p>
      <div className="sai-reply-intents" role="group" aria-label="회신 방향 선택">
        {REPLY_INTENTS.map((key) => {
          const active = intent === key || askIntent === key;
          const isRecommended = recommended === key;
          return (
            <button
              key={key}
              type="button"
              className={`sai-reply-intent${active ? ' sai-reply-intent-on' : ''}${
                isRecommended ? ' sai-reply-intent-rec' : ''
              }`}
              onClick={() => onPick(key)}
              disabled={loading}
              aria-pressed={active}
            >
              {REPLY_INTENT_LABELS[key]}
              {/**
               * 🔴 색만으로 추천을 표시하지 않는다 — 색각 이상·흑백 출력·고대비 모드에서 추천이
               *    통째로 사라진다. 「추천」 두 글자를 함께 넣어 색은 보조 신호로만 쓴다.
               */}
              {isRecommended && <span className="sai-reply-rec-tag">추천</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 회신 초안 본문 (S37) — 질문 카드 / 로딩 / 초안 / 검증 결과 / 복사.
 *
 * 🔴 **초안을 「완성된 답」으로 보이게 하지 않는다.** 여기서 나오는 문장은 사용자가 그대로
 *    복사해 상대에게 보내는 것이라, 자리표시자와 미검증 구체값을 초안 **바로 아래** 붙여 둔다.
 *    토글 뒤에 숨기지 않는 이유가 여기 있다 — 접혀 있으면 안 보고 보낸다.
 * 🔴 S40 — 넓은 창에서는 **별도 패널**(`standalone`), 좁은 창에서는 해독 팝업 안에 이어 붙는다.
 *    같은 컴포넌트가 두 자리를 모두 맡으므로 내용이 갈라질 일이 없다.
 */
export function ReplyPanel({
  askIntent,
  answers,
  onAnswersChange,
  onSubmit,
  onSkip,
  result,
  loading,
  error,
  sourceText,
  sentAnswerText,
  onToast,
  standalone = false,
  onClose,
  onRefine,
  draftText,
  onDraftTextChange,
}) {
  const loadingText = useLoadingMessages(loading, REPLY_LOADING_MESSAGES);
  /**
   * 빈칸을 남긴 채 넘기려 할 때 한 번 되묻는 상태. 🔴 패널 안에만 두는 이유: 이 확인은 다음
   * 클릭까지만 사는 임시 상태다. 위로 올리면 초안·답변과 함께 초기화 규칙을 관리해야 한다.
   */
  const [confirming, setConfirming] = useState(false);
  const modelDraft = result?.fallback ? null : result?.draft ?? null;
  /**
   * 🔴 화면에 보이는 것은 **사용자가 편집 중인 문장**이다(v5). 검증도 이 값을 대상으로 한다 —
   *    모델이 만든 원본을 검증하면, 사용자가 자리표시자를 채운 뒤에도 「채워 주세요」가 남는다.
   */
  const draft = modelDraft === null ? null : draftText;
  const check = verifyReplyDraft({ draft }, sourceText, sentAnswerText);

  async function handleCopy() {
    const ok = await copyToClipboard(draft ?? '');
    onToast?.(ok ? '회신 초안을 복사했어요 (Ctrl+V)' : '복사하지 못했어요. 직접 선택해 복사해 주세요.');
  }

  const body = (
    <>
      {askIntent && (
        <QuestionCard
          intent={askIntent}
          answers={answers}
          onChange={onAnswersChange}
          onSubmit={onSubmit}
          onSkip={onSkip}
        />
      )}

      {loading && (
        <span className="sai-loading">
          {loadingText}
        </span>
      )}
      {!loading && error && <p className="sai-ainote sai-error">{error}</p>}
      {/* 🔴 폴백은 초안 자리를 비운 채 실패만 알린다 — 예시 문장을 답으로 오인시키지 않는다. */}
      {!loading && !error && result?.fallback && (
        <p className="sai-ainote sai-error">{result.fallbackNotice}</p>
      )}

      {!loading && !error && draft !== null && (
        <>
          {/**
           * 🔴 **편집 가능하다** (v5). 자리표시자를 채우는 자리가 여기다 — 모국어에서 채운 뒤
           *    다듬기가 번역한다. 읽기 전용으로 두면 사용자는 빈칸을 **번역된 외국어 쪽에서**
           *    채워야 하고, 그건 이 제품이 없애려는 바로 그 일이다.
           */}
          <textarea
            className="sai-reply-draft sai-reply-draft-edit"
            value={draft}
            onChange={(event) => onDraftTextChange?.(event.target.value)}
            rows={5}
            aria-label="회신 초안 (편집 가능)"
          />

          {check.needsAttention && (
            <div className="sai-reply-check" role="status">
              {check.placeholders.length > 0 && (
                <p className="sai-reply-check-line">
                  <span className="sai-reply-check-tag">채워 주세요</span>
                  {check.placeholders.join(' · ')}
                </p>
              )}
              {/**
               * 🔴 원문에 없는 구체값 — 사용자가 한 적 없는 약속이 될 수 있는 값들이다.
               *    문장을 고치지 않고 값만 짚어 준다(무엇이 모델의 말이고 무엇이 우리 코드의
               *    말인지 섞이지 않게).
               */}
              {check.unverified.length > 0 && (
                <p className="sai-reply-check-line sai-reply-check-warn">
                  <span className="sai-reply-check-tag sai-reply-check-tag-warn">확인 필요</span>
                  받은 메시지에 없는 값이에요 — {check.unverified.join(' · ')}
                </p>
              )}
            </div>
          )}

          {/**
           * 🔴 주 동작은 **다듬기로 넘기기**다 (v5). 여기서 나가는 문장은 아직 모국어라 그대로
           *    보낼 수 없다 — 번역·용어집·수신자 톤은 다듬기가 한다. 「복사」는 초안만 따로
           *    쓰려는 경우를 위한 보조 경로로 남긴다.
           */}
          {/**
           * 🔴 빈칸이 남아 있으면 **한 번 되묻는다** (2026-08-14 사용자 지적). 실확장에서
           *    `[일시]`가 남은 채 다듬기까지 넘어갔다 — 안내 문구만으로는 안 읽힌다.
           * 🔴 **막지는 않는다.** 대괄호를 일부러 남겨 메신저에서 채우는 사용법이 있다.
           *    그래서 「그대로 진행」이 항상 있고, 기본 시선은 「돌아가 채우기」에 둔다.
           */}
          {confirming ? (
            <div className="sai-reply-confirm" role="alertdialog">
              <p className="sai-reply-confirm-text">
                <strong>{check.placeholders.join(' · ')}</strong>을(를) 아직 안 채우셨어요.
                이대로 넘기면 대괄호가 그대로 번역돼 상대에게 갑니다.
              </p>
              <div className="sai-reply-actions">
                <button
                  type="button"
                  className="sai-reply-plain"
                  onClick={() => {
                    setConfirming(false);
                    onRefine?.(draft);
                  }}
                >
                  그대로 진행
                </button>
                <button
                  type="button"
                  className="sai-reply-copy"
                  onClick={() => setConfirming(false)}
                >
                  돌아가 채우기
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="sai-reply-actions">
                <button type="button" className="sai-reply-plain" onClick={handleCopy}>
                  초안 복사
                </button>
                <button
                  type="button"
                  className="sai-reply-copy"
                  onClick={() => {
                    if (check.placeholders.length > 0) {
                      setConfirming(true);
                      return;
                    }
                    onRefine?.(draft);
                  }}
                  disabled={draft.trim() === ''}
                >
                  다듬어서 보내기
                </button>
              </div>
              {check.placeholders.length > 0 && (
                <p className="sai-reply-hint">
                  {/* 🔴 해요체로 통일 (2026-08-15) — 「번역돼요」와 「번역됩니다」가 한 문장 안에
                      섞여 있었다. */}
                  빈칸을 채우고 넘기면 그대로 번역돼요. 남겨 두면 대괄호째 번역돼요.
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  );

  if (!standalone) return <div className="sai-decode-section sai-reply-body">{body}</div>;

  return (
    <div className="sai-popup sai-popup-narrow" role="dialog" aria-label="사이 회신 초안">
      <div className="sai-popup-head">
        <span className="sai-brand">
          <SaiMark size={28} />
          <span className="sai-brand-name">S·AI</span>
          <span className="sai-badge sai-badge-green">회신 초안</span>
        </span>
        {/* 🔴 옆 패널만 닫는다 — 해독 결과는 남는다. 방향을 다시 고를 수 있어야 한다. */}
        <button type="button" className="sai-close" onClick={onClose} aria-label="회신 초안 닫기">
          ✕
        </button>
      </div>
      <div className="sai-decode-body">{body}</div>
    </div>
  );
}

/**
 * 초안 작성 전 사전 질문 (S37 후속).
 *
 * 🔴 **답을 강제하지 않는다.** 「질문 없이 만들기」가 항상 있고, 빈 항목은 초안에서 자리표시자로
 *    남는다. 답을 강제하면 빨리 초안만 보고 싶은 사용자가 아무 칩이나 누르고, 사실이 아닌 값이
 *    초안에 박힌다 — 자리표시자보다 나쁜 결과다.
 * 🔴 객관식 칩과 직접 입력은 **같은 슬롯 하나**를 공유한다. 둘 다 살려 두면 어느 쪽이 초안에
 *    들어갔는지 화면만 봐서는 알 수 없다.
 */
function QuestionCard({ intent, answers, onChange, onSubmit, onSkip }) {
  const questions = REPLY_QUESTIONS[intent] ?? [];

  function set(id, value) {
    onChange({ ...answers, [id]: value });
  }

  return (
    <div className="sai-reply-ask">
      <p className="sai-reply-ask-head">몇 가지만 알려 주시면 빈칸 없는 초안이 나와요</p>
      {questions.map((item) => (
        <div key={item.id} className="sai-reply-ask-item">
          <div className="sai-reply-ask-q">{item.question}</div>
          <div className="sai-reply-ask-options">
            {item.options.map((option) => (
              <button
                key={option}
                type="button"
                className={`sai-reply-ask-chip${answers[item.id] === option ? ' sai-reply-ask-chip-on' : ''}`}
                onClick={() => set(item.id, answers[item.id] === option ? '' : option)}
                aria-pressed={answers[item.id] === option}
              >
                {option}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="sai-reply-ask-input"
            placeholder="직접 입력"
            value={item.options.includes(answers[item.id]) ? '' : answers[item.id] ?? ''}
            onChange={(event) => set(item.id, event.target.value)}
          />
        </div>
      ))}
      <div className="sai-reply-ask-actions">
        <button type="button" className="sai-reply-ask-skip" onClick={onSkip}>
          질문 없이 만들기
        </button>
        <button type="button" className="sai-reply-copy" onClick={onSubmit}>
          초안 만들기
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="sai-decode-section">
      <div className="sai-decode-section-label">{label}</div>
      {children}
    </div>
  );
}

function UrgencyGap({ surface, actual, gap, reason }) {
  const surfacePct = (URGENCY_ORDER[surface] ?? 1) * 50;
  const actualPct = (URGENCY_ORDER[actual] ?? 1) * 50;

  return (
    <div className="sai-decode-section">
      <div className="sai-decode-gap-head">
        <span className="sai-decode-section-label">체감 긴급도</span>
        {gap ? (
          <span className="sai-decode-gap-value">
            표면 {URGENCY_LABEL[surface]} → 실제 {URGENCY_LABEL[actual]}
          </span>
        ) : (
          <span className="sai-decode-gap-same">표면과 실제가 같아요</span>
        )}
      </div>
      <div className="sai-decode-gap-track">
        <span className="sai-decode-gap-fill" style={{ width: `${Math.max(surfacePct, actualPct)}%` }} />
        <span className="sai-decode-gap-dot" style={{ left: `${surfacePct}%` }} title="표면" />
        <span
          className="sai-decode-gap-dot sai-decode-gap-dot-actual"
          style={{ left: `${actualPct}%` }}
          title="실제"
        />
      </div>
      {reason && <p className="sai-decode-gap-reason">{reason}</p>}
    </div>
  );
}
