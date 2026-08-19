/**
 * 결정 로그 페이지 (S25 / Spec 부가 7).
 *
 * 🔴 **확장 전용 페이지다** (`chrome-extension://…/src/decisions/index.html`). 호스팅된
 *    웹사이트가 아니라 기기 안에서 열리는 페이지라, 결정 내용이 **네트워크로 나가지 않는다**.
 *    서버·Firestore로 보내는 코드를 여기에 추가하는 순간 Zero Retention 위반이다(필수 5).
 *
 * 🔴 **동의 게이트가 이 화면의 첫 관문이다.** 동의 전에는 목록도 없고 새 요약도 못 받는다 —
 *    "일단 보여주고 저장만 막기"로 하면, 동의 없이 남의 메시지를 뽑아내는 일이 이미 벌어진 뒤다.
 */

import { useCallback, useEffect, useState } from 'react';
import SaiMark from '../assets/SaiMark.jsx';
import {
  hasConsent,
  setConsent,
  listDecisionLogs,
  saveDecisionLog,
  deleteDecisionLog,
  clearDecisionLogs,
  MAX_DECISION_LOGS,
  SAVE_REJECTIONS,
} from '../lib/decisions.js';

/** 권한 상태별 표시 — 색은 「확정」만 초록, 나머지는 중립이다(불확실을 초록으로 칠하지 않는다). */
const AUTHORITY_TONE = {
  확정: 'ok',
  '내부 승인 필요': 'warn',
  '검토 중': 'warn',
  불명: 'unknown',
};

function formatSavedAt(iso) {
  // 🔴 저장된 값은 ISO 문자열이다. Date로 되살리는 것은 표시 순간에만 한다.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '날짜 불명';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 배경에 잠깐 담아 둔 새 요약을 가져온다. 없으면 null — 페이지를 직접 열었을 때가 그렇다. */
async function takePendingSummary() {
  if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) return null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'decisions:takePending' });
    return response?.pending ?? null;
  } catch {
    // 서비스 워커가 잠들어 있었으면 가져올 게 없다 — 오류가 아니라 "없음"이다.
    return null;
  }
}

export default function App() {
  const [consent, setConsentState] = useState(null); // null = 아직 읽는 중
  const [logs, setLogs] = useState([]);
  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    const granted = await hasConsent();
    setConsentState(granted);
    setLogs(granted ? await listDecisionLogs() : []);
  }, []);

  useEffect(() => {
    reload();
    takePendingSummary().then(setPending);
  }, [reload]);

  const grant = async () => {
    await setConsent(true);
    await reload();
    setNotice('');
  };

  const withdraw = async () => {
    const { deletedCount } = await setConsent(false);
    setPending(null);
    await reload();
    setNotice(
      deletedCount > 0
        ? `동의를 철회하고 저장돼 있던 ${deletedCount}건을 지웠어요.`
        : '동의를 철회했어요.',
    );
  };

  const save = async () => {
    const result = await saveDecisionLog({
      decisions: pending.decisions,
      sourceLabel: pending.sourceLabel ?? null,
    });
    if (!result.ok) {
      setNotice(
        result.reason === SAVE_REJECTIONS.FULL
          ? `저장 한도(${MAX_DECISION_LOGS}건)가 찼어요. 오래된 기록을 지운 뒤 다시 시도해 주세요.`
          : '저장하지 않았어요.',
      );
      return;
    }
    setPending(null);
    await reload();
    setNotice('저장했어요.');
  };

  if (consent === null) return <main className="page" />;

  return (
    <main className="page">
      <header className="head">
        <span className="brand">
          <SaiMark className="brand-mark" size={26} />
          <span className="brand-name">사이</span>
          <span className="brand-sub">결정 로그</span>
        </span>
        {consent && (
          <span className="head-actions">
            <span className="count">
              {logs.length} / {MAX_DECISION_LOGS}
            </span>
            {logs.length > 0 && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={async () => {
                  const { deletedCount } = await clearDecisionLogs();
                  await reload();
                  setNotice(`${deletedCount}건을 지웠어요.`);
                }}
              >
                전체 비우기
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={withdraw}>
              동의 철회
            </button>
          </span>
        )}
      </header>

      {notice && <p className="notice">{notice}</p>}

      {!consent ? <ConsentGate onGrant={grant} /> : null}

      {consent && pending && <PendingCard pending={pending} onSave={save} onDiscard={() => setPending(null)} />}

      {consent && (
        <section className="logs">
          {logs.length === 0 && !pending ? (
            <EmptyState />
          ) : (
            logs.map((entry) => (
              <LogCard
                key={entry.id}
                entry={entry}
                onDelete={async () => {
                  await deleteDecisionLog(entry.id);
                  await reload();
                  setNotice('한 건을 지웠어요.');
                }}
              />
            ))
          )}
        </section>
      )}
    </main>
  );
}

/**
 * 🔴 동의 화면은 **무엇이 어디에 남는지**를 먼저 말한다. "동의하시겠습니까?"만 묻는 화면은
 *    동의를 받은 것이 아니라 클릭을 받은 것이다.
 */
function ConsentGate({ onGrant }) {
  return (
    <section className="consent">
      <h1 className="consent-title">이 기능은 대화 내용을 이 기기에 저장해요</h1>
      <p className="consent-lead">
        결정 로그는 대화에서 <b>무엇이 정해졌는지</b>를 표로 뽑아 둡니다. 그 표에는 상대가 쓴
        메시지에서 나온 내용이 들어갑니다. 시작하기 전에 무엇이 남는지 알려드릴게요.
      </p>

      <dl className="consent-facts">
        <div>
          <dt>저장되는 것</dt>
          <dd>결정 내용 · 담당자 · 기한 · 권한 상태와 그 근거 문장, 저장 시각, 사이트 호스트명</dd>
        </div>
        <div>
          <dt>저장되는 곳</dt>
          <dd>
            <b>이 브라우저 안에만</b> 저장됩니다(<code>chrome.storage.local</code>). 사이 서버로도,
            구글 계정 동기화로도 나가지 않아요.
          </dd>
        </div>
        <div>
          <dt>요약할 때</dt>
          <dd>
            요약을 만드는 순간에는 대화 원문이 AI에 전달됩니다. <b>서버에는 저장되지 않고</b>{' '}
            처리 후 사라집니다 — 남는 건 건수 같은 수치뿐이에요.
          </dd>
        </div>
        <div>
          <dt>지우고 싶을 때</dt>
          <dd>
            한 건씩, 전체, 또는 <b>동의 철회</b>로 지울 수 있어요. 철회하면 저장된 기록도 함께
            지워집니다.
          </dd>
        </div>
      </dl>

      {/* 🔴 우리가 대신 약속할 수 없는 것은 약속하지 않는다. */}
      <p className="consent-caveat">
        대화 상대는 자기 말이 요약돼 남는 데 동의한 적이 없습니다. 저장한 내용을 다른 곳에 옮기실
        때는 그 점을 감안해 주세요.
      </p>

      <button type="button" className="btn btn-primary btn-lg" onClick={onGrant}>
        이해했어요 — 기능 사용하기
      </button>
      <p className="consent-foot">동의하지 않으면 결정 요약 기능은 동작하지 않아요.</p>
    </section>
  );
}

function EmptyState() {
  return (
    <p className="empty">
      아직 저장한 결정이 없어요. 대화 페이지에서 요약할 부분을 <b>드래그해 선택</b>한 뒤 사이
      버튼의 <b>「결정 요약」</b>을 누르면 여기에 쌓입니다.
    </p>
  );
}

/** 방금 만든 요약 — 아직 저장 전이다. 저장은 사용자가 눌러야만 일어난다(조건 ①). */
function PendingCard({ pending, onSave, onDiscard }) {
  return (
    <section className="card card-pending">
      <div className="card-head">
        <h2 className="card-title">방금 만든 요약</h2>
        <span className="card-meta">아직 저장되지 않았어요</span>
      </div>

      {/**
       * 🔴 **무엇을 읽었는지 먼저 말한다** (2026-08-14 사용자 실측으로 추가). 자동 수집은
       *    구조 휴리스틱이라 사이트에 따라 엉뚱한 블록을 집을 수 있다(Lessons #3·#4). 그 사실을
       *    숨기면 사용자가 남의 대화에서 뽑힌 표를 자기 대화의 결론으로 믿는다 — 실제로 그런
       *    일이 있었다(짧은 선택이 무시되고 페이지 전체가 요약됐다).
       */}
      <SourceLine pending={pending} />

      {pending.truncated && (
        <p className="warn-line">
          대화가 길어 <b>앞부분을 잘라</b> 요약했어요 — 뒤쪽 대화를 기준으로 읽었습니다.
        </p>
      )}

      {/**
       * 🔴 **"결정이 없었다"와 "읽지 못했다"를 절대 같은 문구로 말하지 않는다** (2026-08-14
       *    사용자 실측으로 드러난 결함). 코어는 두 경우를 `fallback` 플래그로 구분해 돌려주는데
       *    이 화면이 그걸 안 읽고 둘 다 「결정을 찾지 못했어요」로 표시하고 있었다 — 백엔드가
       *    죽었을 때 사용자가 **자기 대화에 결정이 없다고 오해한다**. 뜻이 정반대인 두 상태다.
       */}
      {pending.fallbackNotice ? (
        <p className="fail">
          {pending.fallbackNotice}
          <span className="fail-sub">
            대화를 읽지 못한 것이지, 이 대화에 결정이 없다는 뜻이 아니에요.
          </span>
        </p>
      ) : pending.decisions.length === 0 ? (
        <p className="empty">이 대화에서는 확정된 결정을 찾지 못했어요.</p>
      ) : (
        <DecisionTable decisions={pending.decisions} />
      )}

      <div className="card-foot">
        <button type="button" className="btn btn-quiet" onClick={onDiscard}>
          저장 안 함
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={pending.decisions.length === 0}
        >
          저장하기
        </button>
      </div>
    </section>
  );
}

/** 읽은 범위를 한 줄로 밝힌다. 자동 수집일 때는 **틀릴 수 있다는 것까지** 말한다. */
function SourceLine({ pending }) {
  if (pending.source === 'selection') {
    return (
      <p className="source-line">
        <b>드래그해 선택한 부분</b>만 읽었어요.
        {pending.redactedCount > 0 && ' 민감정보로 보이는 부분은 가리고 보냈어요.'}
      </p>
    );
  }
  if (pending.source === 'thread') {
    return (
      <p className="source-line source-line-auto">
        선택한 부분이 없어 <b>이 페이지에서 대화 {pending.messageCount}개를 자동으로 모아</b>{' '}
        읽었어요.
        <span className="source-sub">
          자동 수집은 사이트 구조를 추측하는 것이라 엉뚱한 부분을 집을 수 있어요. 원하는 범위를
          드래그한 뒤 다시 실행하면 그 부분만 읽습니다.
        </span>
      </p>
    );
  }
  return null;
}

function LogCard({ entry, onDelete }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">{entry.title ?? formatSavedAt(entry.savedAt)}</h2>
        <span className="card-meta">
          {entry.sourceLabel && <span className="src">{entry.sourceLabel}</span>}
          결정 {entry.decisionCount}건
          {entry.unresolvedCount > 0 && (
            <span className="meta-warn"> · 미확정 {entry.unresolvedCount}건</span>
          )}
        </span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDelete}>
          삭제
        </button>
      </div>
      <DecisionTable decisions={entry.decisions} />
    </section>
  );
}

/**
 * 🔴 **빈 칸을 지어내지 않는다.** 담당자·기한이 없으면 「미정」이라고 쓴다 — 근거가 없어서
 *    비어 있는 것과 우리가 못 읽은 것을 구분하지 않으면, 읽는 사람이 빈칸을 알아서 채운다.
 */
function DecisionTable({ decisions }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>결정</th>
            <th>담당자</th>
            <th>기한</th>
            <th>권한</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((row, index) => {
            const unresolved = row.owner === null || row.dueDate === null;
            return (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index} className={unresolved ? 'row-unresolved' : undefined}>
                <td>{row.decision}</td>
                <td>{row.owner ?? <span className="none">미정</span>}</td>
                <td>{row.dueDate ?? <span className="none">미정</span>}</td>
                <td>
                  <span className={`tag tag-${AUTHORITY_TONE[row.authorityStatus] ?? 'unknown'}`}>
                    {row.authorityStatus}
                  </span>
                  {row.authorityEvidence && (
                    <span className="evidence">{row.authorityEvidence}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
