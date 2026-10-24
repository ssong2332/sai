import { useEffect, useId, useState } from 'react';
import { Link } from '../router.jsx';
import { BRIDGE_ERRORS, describeError } from '../bridge.js';
import { useExtension } from './useExtension.js';

/**
 * /settings — 「관리하는 자리」. 확장에 저장된 값을 확장을 통해 읽고 바꾼다.
 * 🔴 이 페이지는 서버로 아무것도 보내지 않는다. 연결이 안 되면 컨트롤을 진짜처럼 보여 주지 않는다.
 */

const PANELS = [
  { id: 'general', label: '일반', sub: '화면 · 교정 보기' },
  { id: 'language', label: '언어와 톤', sub: '' },
  { id: 'me', label: '나', sub: '내 정보 · 상황 · 협업 성향' },
  { id: 'glossary', label: '용어집', sub: '' },
  { id: 'learned', label: '학습 내역', sub: '' },
  { id: 'data', label: '데이터와 연결', sub: '' },
];

/** 확장의 학습 반영 기준 — `src/core/profile/diff.js` LEARNING_THRESHOLD(3)와 같다. */
const LEARNING_THRESHOLD = 3;

function readPanel() {
  const id = window.location.hash.slice(1);
  return PANELS.some((p) => p.id === id) ? id : 'general';
}

/* ── 공통 조각 ─────────────────────────────────────────── */

function SaveNote({ save }) {
  if (!save) return <span className="save-note" aria-live="polite" />;
  if (save.state === 'saving')
    return (
      <span className="save-note save-saving" aria-live="polite">
        저장 중…
      </span>
    );
  if (save.state === 'saved')
    return (
      <span className="save-note save-saved" aria-live="polite">
        저장됨
      </span>
    );
  return (
    <span className="save-note save-error" role="alert">
      {save.message}
    </span>
  );
}

function ToggleRow({ label, hint, checked, onChange, save }) {
  const id = useId();
  const [pending, setPending] = useState(null);
  const shown = pending ?? checked;
  const click = async () => {
    const next = !shown;
    setPending(next);
    await onChange(next);
    setPending(null);
  };
  return (
    <div className="row">
      <div className="row-text">
        <span className="row-label" id={`${id}-l`}>
          {label}
        </span>
        {hint && (
          <span className="row-hint" id={`${id}-h`}>
            {hint}
          </span>
        )}
        <SaveNote save={save} />
      </div>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={shown}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        disabled={save?.state === 'saving'}
        onClick={click}
      />
    </div>
  );
}

function ChoiceRow({ label, hint, options, value, onChange, save, allowNone = false }) {
  const id = useId();
  const [pending, setPending] = useState(undefined);
  const shown = pending === undefined ? value : pending;
  const pick = async (next) => {
    if (next === shown) return;
    setPending(next);
    await onChange(next);
    setPending(undefined);
  };
  const list = allowNone ? [...options, { id: null, label: '선택 안 함' }] : options;
  return (
    <div className="row row-stack">
      <div className="row-text">
        <span className="row-label" id={`${id}-l`}>
          {label}
        </span>
        {hint && <span className="row-hint">{hint}</span>}
        <SaveNote save={save} />
      </div>
      <div className="segmented" role="radiogroup" aria-labelledby={`${id}-l`}>
        {list.map((opt) => (
          <button
            key={String(opt.id)}
            type="button"
            role="radio"
            aria-checked={shown === opt.id}
            disabled={save?.state === 'saving'}
            onClick={() => pick(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectRow({ label, hint, options, value, onChange, save }) {
  const id = useId();
  return (
    <div className="row">
      <div className="row-text">
        <label className="row-label" htmlFor={id}>
          {label}
        </label>
        {hint && <span className="row-hint">{hint}</span>}
        <SaveNote save={save} />
      </div>
      <select
        id={id}
        className="field-select row-select"
        value={value ?? ''}
        disabled={save?.state === 'saving'}
        onChange={(e) => onChange(e.target.value || null)}
      >
        {value == null && <option value="">선택 안 함</option>}
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextRow({ label, hint, value, onSave, save, placeholder, maxLength = 40 }) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== (value ?? '')) onSave(next);
  };
  return (
    <div className="row">
      <div className="row-text">
        <label className="row-label" htmlFor={id}>
          {label}
        </label>
        {hint && <span className="row-hint">{hint}</span>}
        <SaveNote save={save} />
      </div>
      <input
        id={id}
        className="field-input row-input"
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(value ?? '');
        }}
      />
    </div>
  );
}

function Group({ title, note, children }) {
  return (
    <section className="group">
      <h3 className="group-title">{title}</h3>
      {note && <p className="group-note">{note}</p>}
      <div className="group-rows">{children}</div>
    </section>
  );
}

/* ── 패널 ─────────────────────────────────────────────── */

function GeneralPanel({ s, saves, set }) {
  const d = s.display;
  const toggle = (field) => (next) => set('display', { [field]: next }, `display.${field}`);
  return (
    <>
      <Group
        title="메시지가 바뀌는 설정"
        note="상대에게 나가는 문장이 달라져요. 이번 한 번만 바꾸려면 교정 팝업에서 끄고 켤 수 있어요."
      >
        <ToggleRow
          label="직전 대화 참고"
          hint="같은 화면의 직전 메시지 최대 5개를 함께 보내 문맥에 맞게 다듬어요. 다른 사람이 쓴 메시지가 포함될 수 있고, 그 내용은 저장하지 않아요."
          checked={d.threadContext}
          onChange={toggle('threadContext')}
          save={saves['display.threadContext']}
        />
      </Group>

      <Group title="문장을 넣을 때" note="다듬은 문장·저장 문구를 입력창에 넣는 방식이에요.">
        <ToggleRow
          label="저장 문구를 뒤에 이어 붙이기"
          hint="끄면 입력창의 기존 내용을 지우고 넣어요."
          checked={d.snippetInsertMode === 'append'}
          onChange={(next) =>
            set('display', { snippetInsertMode: next ? 'append' : 'replace' }, 'display.snippetInsertMode')
          }
          save={saves['display.snippetInsertMode']}
        />
        <ToggleRow
          label="회신 초안 바로 만들기"
          hint="받은 메시지에 회신 방향을 고르면 질문 없이 바로 초안을 만들어요. 끄면 초안의 빈칸을 줄이는 질문을 먼저 해요."
          checked={d.replyAuto}
          onChange={toggle('replyAuto')}
          save={saves['display.replyAuto']}
        />
      </Group>

      <Group title="교정을 보는 방법" note="나가는 문장은 그대로예요. 내가 확인하는 방식만 달라져요.">
        <ToggleRow
          label="역번역 보기"
          hint="다듬은 문장이 상대에게 어떻게 읽히는지 한국어로 되돌려 보여 줘요."
          checked={d.backTranslation}
          onChange={toggle('backTranslation')}
          save={saves['display.backTranslation']}
        />
        <ToggleRow
          label="변경 이유 보기"
          hint="무엇을 왜 바꿨는지, 원문의 기한·숫자가 그대로 남았는지 대조한 내용을 펼쳐 둬요."
          checked={d.refineReasoning}
          onChange={toggle('refineReasoning')}
          save={saves['display.refineReasoning']}
        />
        <ToggleRow
          label="색 표시 설명"
          hint="초록·노란 표시가 무슨 뜻인지 알려 줘요. 표시 자체는 항상 켜져 있어요."
          checked={d.highlightHints}
          onChange={toggle('highlightHints')}
          save={saves['display.highlightHints']}
        />
        <ToggleRow
          label="참고한 대화 미리보기"
          hint="직전 대화 참고가 켜져 있을 때, 팝업에 참고한 메시지를 보여 줘요. 끄면 화면에서만 가리고 참고는 그대로 해요."
          checked={d.threadContextPreview}
          onChange={toggle('threadContextPreview')}
          save={saves['display.threadContextPreview']}
        />
      </Group>

      <Group title="확장 화면">
        <ChoiceRow
          label="확장 테마"
          hint="사이드 패널과 페이지 팝업에 함께 적용돼요. 이 웹페이지의 테마는 오른쪽 위 버튼으로 따로 바꿔요."
          options={[
            { id: 'light', label: '밝게' },
            { id: 'dark', label: '어둡게' },
          ]}
          value={d.theme}
          onChange={(next) => set('display', { theme: next }, 'display.theme')}
          save={saves['display.theme']}
        />
      </Group>
    </>
  );
}

function LanguagePanel({ s, saves, set }) {
  const l = s.language;
  const o = s.options;
  return (
    <Group title="언어와 톤" note="처음 설정에서 고른 값이에요. 바꾸면 다음 교정부터 적용돼요.">
      <SelectRow
        label="내 언어"
        hint="내가 쓰고 읽는 언어예요. 역번역과 해석이 이 언어로 나와요."
        options={o.languages}
        value={l.myLanguage}
        onChange={(next) => set('language', { myLanguage: next }, 'language.myLanguage')}
        save={saves['language.myLanguage']}
      />
      <ChoiceRow
        label="주 협업 지역"
        hint="상대에게 보낼 언어의 기본값을 정하는 데만 써요. 상대의 성향이나 말투를 짐작하는 데 쓰지 않아요."
        options={o.partnerRegions}
        value={l.partnerRegion}
        onChange={(next) => set('language', { partnerRegion: next }, 'language.partnerRegion')}
        save={saves['language.partnerRegion']}
      />
      <ChoiceRow
        label="기본 톤"
        hint="따로 정하지 않았을 때 다듬는 말투예요."
        options={o.tones}
        value={l.tone}
        onChange={(next) => set('language', { tone: next }, 'language.tone')}
        save={saves['language.tone']}
      />
    </Group>
  );
}

function MePanel({ s, saves, set }) {
  const o = s.options;
  return (
    <>
      <Group title="내 정보" note="팀에서 나를 알아보게 하는 이름과 직급이에요. 팀을 만들거나 참가할 때만 함께 보내요.">
        <TextRow
          label="표시 이름"
          value={s.identity.displayName}
          placeholder="예: 김사이"
          onSave={(next) => set('identity', { displayName: next }, 'identity.displayName')}
          save={saves['identity.displayName']}
        />
        <TextRow
          label="직급"
          value={s.identity.jobTitle}
          placeholder="예: 백엔드 개발자"
          onSave={(next) => set('identity', { jobTitle: next }, 'identity.jobTitle')}
          save={saves['identity.jobTitle']}
        />
      </Group>
      <Group
        title="상황과 협업 성향"
        note="교정에서 가장 먼저 따르는 기준이에요. 상대가 어느 나라 사람인지보다 지금 어떤 일을 하는지, 내가 어떻게 일하는지를 먼저 봅니다."
      >
        <ChoiceRow
          label="자주 쓰는 상황"
          options={o.situations}
          value={s.profile.situationId ?? null}
          allowNone
          onChange={(next) => set('profile', { situationId: next }, 'profile.situationId')}
          save={saves['profile.situationId']}
        />
        <ChoiceRow
          label="협업 성향"
          options={o.collabStyles}
          value={s.profile.collabStyleId ?? null}
          allowNone
          onChange={(next) => set('profile', { collabStyleId: next }, 'profile.collabStyleId')}
          save={saves['profile.collabStyleId']}
        />
      </Group>
    </>
  );
}

function languageLabel(options, id) {
  if (id == null) return '모든 언어';
  return options.find((o) => o.id === id)?.label ?? id;
}

function GlossaryEditor({ initial, languages, onSubmit, onCancel, submitLabel, busy }) {
  const [sourceText, setSource] = useState(initial?.sourceText ?? '');
  const [targetText, setTarget] = useState(initial?.targetText ?? '');
  const [keepSource, setKeep] = useState(!!initial?.keepSource);
  const [language, setLanguage] = useState(initial?.language ?? null);
  const ids = { s: useId(), t: useId(), l: useId(), k: useId() };
  const canSubmit = sourceText.trim() !== '' && (keepSource || targetText.trim() !== '');

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await onSubmit({
      sourceText: sourceText.trim(),
      targetText: keepSource ? null : targetText.trim(),
      keepSource,
      language,
    });
    if (ok && !initial) {
      setSource('');
      setTarget('');
      setKeep(false);
    }
  };

  return (
    <form className="gl-editor" onSubmit={submit}>
      <div className="gl-field">
        <label htmlFor={ids.s}>원문</label>
        <input
          id={ids.s}
          className="field-input"
          value={sourceText}
          maxLength={200}
          placeholder="예: 배포"
          onChange={(e) => setSource(e.target.value)}
        />
      </div>
      <div className="gl-field">
        <label htmlFor={ids.t}>바꿀 말</label>
        <input
          id={ids.t}
          className="field-input"
          value={keepSource ? '' : targetText}
          maxLength={200}
          disabled={keepSource}
          placeholder={keepSource ? '원문 그대로 둬요' : '예: deploy'}
          onChange={(e) => setTarget(e.target.value)}
        />
      </div>
      <div className="gl-field">
        <label htmlFor={ids.l}>언어</label>
        <select
          id={ids.l}
          className="field-select"
          value={language ?? ''}
          onChange={(e) => setLanguage(e.target.value || null)}
        >
          <option value="">모든 언어</option>
          {languages.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="gl-field gl-field-keep">
        <span id={ids.k}>원문 유지</span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={keepSource}
          aria-labelledby={ids.k}
          onClick={() => setKeep((v) => !v)}
        />
      </div>
      <div className="gl-actions">
        <button type="submit" className="btn btn-small btn-action" disabled={!canSubmit || busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-small" onClick={onCancel}>
            취소
          </button>
        )}
      </div>
    </form>
  );
}

function GlossaryPanel({ s, saves, actions }) {
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const langs = s.options.glossaryLanguages;
  const list = s.glossary;

  return (
    <>
      <Group
        title="용어 추가"
        note="교정할 때 이 말은 이렇게 옮겨요. 「원문 유지」를 켜면 제품 이름처럼 번역하지 않고 그대로 둬요. 다듬은 문장에 등록한 말이 빠지면 「용어집 확인 필요」로 알려 드려요."
      >
        <GlossaryEditor
          languages={langs}
          submitLabel="추가"
          busy={saves['glossary.add']?.state === 'saving'}
          onSubmit={(entry) => actions.addGlossary(entry)}
        />
        <SaveNote save={saves['glossary.add']} />
      </Group>

      <section className="group">
        <h3 className="group-title">
          등록한 용어 <span className="count mono">{list.length}</span>
        </h3>
        {list.length === 0 ? (
          <p className="empty">아직 등록한 용어가 없어요. 위에서 자주 쓰는 말을 하나 추가해 보세요.</p>
        ) : (
          <table className="gl-table">
            <thead>
              <tr>
                <th scope="col">원문</th>
                <th scope="col">바꿀 말</th>
                <th scope="col">언어</th>
                <th scope="col">원문 유지</th>
                <th scope="col">
                  <span className="sr-only">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) =>
                editing === item.id ? (
                  <tr key={item.id} className="gl-editing">
                    <td colSpan={5}>
                      <GlossaryEditor
                        initial={item}
                        languages={langs}
                        submitLabel="저장"
                        busy={saves[`glossary.${item.id}`]?.state === 'saving'}
                        onCancel={() => setEditing(null)}
                        onSubmit={async (patch) => {
                          const ok = await actions.updateGlossary(item.id, patch);
                          if (ok) setEditing(null);
                          return ok;
                        }}
                      />
                      <SaveNote save={saves[`glossary.${item.id}`]} />
                    </td>
                  </tr>
                ) : (
                  <tr key={item.id}>
                    <td data-label="원문">
                      <span className="gl-source">{item.sourceText}</span>
                    </td>
                    <td data-label="바꿀 말">
                      {item.keepSource ? <span className="gl-muted">원문 그대로</span> : item.targetText}
                    </td>
                    <td data-label="언어">{languageLabel(langs, item.language)}</td>
                    <td data-label="원문 유지">
                      <button
                        type="button"
                        role="switch"
                        className="switch"
                        aria-checked={!!item.keepSource}
                        aria-label={`${item.sourceText} 원문 유지`}
                        disabled={saves[`glossary.${item.id}`]?.state === 'saving'}
                        onClick={() =>
                          // 원문 유지를 끄려면 바꿀 말이 있어야 한다 — 없으면 편집 줄을 연다.
                          item.keepSource && !item.targetText
                            ? setEditing(item.id)
                            : actions.updateGlossary(item.id, { keepSource: !item.keepSource })
                        }
                      />
                    </td>
                    <td className="gl-row-actions">
                      {confirming === item.id ? (
                        <span className="confirm-inline">
                          <span>삭제할까요?</span>
                          <button
                            type="button"
                            className="btn btn-small btn-danger"
                            onClick={async () => {
                              await actions.removeGlossary(item.id);
                              setConfirming(null);
                            }}
                          >
                            삭제
                          </button>
                          <button type="button" className="btn btn-small" onClick={() => setConfirming(null)}>
                            취소
                          </button>
                        </span>
                      ) : (
                        <>
                          <button type="button" className="link-button" onClick={() => setEditing(item.id)}>
                            수정
                          </button>
                          <button type="button" className="link-button" onClick={() => setConfirming(item.id)}>
                            삭제
                          </button>
                        </>
                      )}
                      <SaveNote save={saves[`glossary.${item.id}`]} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function LearnedPanel({ s, saves, actions }) {
  const [confirmAll, setConfirmAll] = useState(false);
  const counts = s.learned?.counts ?? {};
  const cats = s.options.learnedCategories;
  const rows = cats.filter((c) => (counts[c.id] ?? 0) > 0);

  return (
    <section className="group">
      <h3 className="group-title">내 수정 습관</h3>
      <p className="group-note">
        다듬은 문장을 내가 다시 고쳐 쓰면, 어떤 종류의 수정이었는지 <b>횟수만</b> 셉니다. 문장은 저장하지 않아요. 같은
        종류가 {LEARNING_THRESHOLD}번 이상 쌓이면 다음 교정에 반영돼요.
      </p>
      {rows.length === 0 ? (
        <p className="empty">아직 쌓인 학습 내역이 없어요.</p>
      ) : (
        <>
          <ul className="learned-list">
            {rows.map((c) => {
              const n = counts[c.id];
              const save = saves[`learned.${c.id}`];
              return (
                <li key={c.id} className="learned-row">
                  <div className="learned-text">
                    <span className="row-label">{c.label}</span>
                    <span className="row-hint mono">
                      {n}회 · {n >= LEARNING_THRESHOLD ? '교정에 반영 중' : `${LEARNING_THRESHOLD}회부터 반영`}
                    </span>
                    <SaveNote save={save} />
                  </div>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={save?.state === 'saving'}
                    onClick={() => actions.removeLearned(c.id)}
                    aria-label={`${c.label} 학습 내역 삭제`}
                  >
                    삭제
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="learned-all">
            {confirmAll ? (
              <div className="confirm-box" role="group" aria-label="학습 내역 전체 삭제 확인">
                <p>
                  학습 내역 {rows.length}가지를 모두 지워요. 서버에 동기화한 적이 있다면 그 기록도 확장이 다음 동기화 때
                  함께 지웁니다. 되돌릴 수 없어요.
                </p>
                <div className="confirm-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={async () => {
                      const ok = await actions.clearLearned();
                      if (ok) setConfirmAll(false);
                    }}
                  >
                    전체 삭제
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => setConfirmAll(false)}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="link-button" onClick={() => setConfirmAll(true)}>
                전체 삭제
              </button>
            )}
            <SaveNote save={saves['learned.all']} />
          </div>
        </>
      )}
    </section>
  );
}

function DataPanel({ status, demo }) {
  return (
    <>
      <Group title="이 페이지가 하는 일">
        <div className="prose">
          <p>
            이 페이지는 <b>이 컴퓨터의 크롬 확장에 저장된 값</b>을 확장을 통해 읽고 바꿉니다. 바꾼 값은 확장 안에 바로
            저장되고, 이 페이지가 서버로 보내는 것은 없습니다.
          </p>
          <p>로그인한 경우 확장이 따로 하는 동기화는 확장의 계정 설정을 따릅니다.</p>
        </div>
        <dl className="conn">
          <div>
            <dt>연결</dt>
            <dd>{demo ? '미리보기(예시 데이터)' : '확장과 연결됨'}</dd>
          </div>
          <div>
            <dt>확장 버전</dt>
            <dd className="mono">{status.version ?? '알 수 없음'}</dd>
          </div>
          <div>
            <dt>로그인</dt>
            <dd>{status.signedIn ? '로그인함' : '로그인 안 함'}</dd>
          </div>
        </dl>
      </Group>
      <Group title="여기서 관리하지 않는 것" note="아래는 확장 안에서만 보고 바꿀 수 있어요.">
        <ul className="not-here">
          <li>
            <b>저장 문구 · 예약</b>
            <span>메시지 본문이라 확장 안에만 둡니다.</span>
          </li>
          <li>
            <b>수신자</b>
            <span>다른 사람의 정보라 확장에서만 다룹니다.</span>
          </li>
          <li>
            <b>팀</b>
            <span>확장 사이드 패널의 팀 탭에서 관리해요.</span>
          </li>
        </ul>
      </Group>
    </>
  );
}

/* ── 연결 상태 ────────────────────────────────────────── */

function isChrome() {
  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands)) return brands.some((b) => /Google Chrome|Chromium/.test(b.brand));
  return /Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\//.test(navigator.userAgent);
}

function NotConnected({ status, onRetry }) {
  let title = '확장을 찾지 못했어요';
  let lead = '이 페이지는 크롬 확장과 연결돼야 설정을 보여 줄 수 있어요.';
  if (status.state === 'outdated') {
    title = '확장 업데이트가 필요해요';
    lead = '설치된 사이 확장이 이 페이지와 이야기하는 방법을 아직 모르는 버전이에요.';
  } else if (status.state === 'forbidden') {
    title = '이 주소에서는 연결할 수 없어요';
    lead = describeError('forbidden_origin');
  } else if (status.reason === BRIDGE_ERRORS.NO_RUNTIME && !isChrome()) {
    title = 'Chrome에서 열어 주세요';
    lead = '사이는 크롬 확장 프로그램이라, 설정 페이지도 확장이 설치된 Chrome에서만 연결돼요.';
  } else if (status.reason === BRIDGE_ERRORS.TIMEOUT) {
    lead = describeError(BRIDGE_ERRORS.TIMEOUT);
  }

  return (
    <div className="nc">
      <h2 className="nc-title">{title}</h2>
      <p className="nc-lead">{lead}</p>
      <ol className="nc-steps">
        <li>
          <b>설치하거나 업데이트하기</b> — Chrome 웹 스토어 출시를 준비하고 있어요. 이미 설치했다면
          chrome://extensions에서 사이를 최신 버전으로 업데이트하세요.
        </li>
        <li>
          <b>확장 다시 로드하기</b> — chrome://extensions에서 사이가 켜져 있는지 확인하고 새로고침 버튼을 누르세요.
        </li>
        <li>
          <b>이 페이지 새로고침</b> — 확장은 열려 있던 페이지를 알아보지 못해요. 이 페이지를 새로 열어야 연결돼요.
        </li>
      </ol>
      <div className="nc-actions">
        <button type="button" className="btn btn-action" onClick={onRetry}>
          다시 확인
        </button>
        <Link to="/settings?demo=1" className="btn">
          예시 데이터로 둘러보기
        </Link>
      </div>
      <p className="nc-foot">연결되기 전에는 설정을 보여 주지 않아요. 아무것도 저장되지 않습니다.</p>
    </div>
  );
}

function StatusStrip({ status, demo }) {
  if (demo) {
    return (
      <div className="strip strip-demo" role="status">
        <span className="strip-dot" aria-hidden="true" />
        <span>
          <b>미리보기</b> — 확장과 연결되지 않은 예시 데이터입니다. 바꾼 값은 이 탭을 닫으면 사라져요.
        </span>
        <Link to="/settings" className="strip-link">
          미리보기 끄기
        </Link>
      </div>
    );
  }
  if (status.state === 'checking') {
    return (
      <div className="strip" role="status">
        <span className="strip-dot strip-dot-wait" aria-hidden="true" />
        <span>확장을 찾는 중…</span>
      </div>
    );
  }
  if (status.state === 'connected') {
    return (
      <div className="strip strip-ok" role="status">
        <span className="strip-dot" aria-hidden="true" />
        <span>
          <b>확장과 연결됨</b>
          <span className="mono strip-meta">
            {status.version ? ` v${status.version}` : ''} · {status.signedIn ? '로그인함' : '로그인 안 함'}
          </span>{' '}
          — 바꾸면 바로 확장에 저장돼요.
        </span>
      </div>
    );
  }
  return (
    <div className="strip strip-off" role="status">
      <span className="strip-dot" aria-hidden="true" />
      <span>
        <b>연결 안 됨</b> — 확장과 연결되지 않았어요.
      </span>
    </div>
  );
}

/* ── 페이지 ────────────────────────────────────────────── */

export default function Settings({ search }) {
  const demo = new URLSearchParams(search).get('demo') === '1';
  const { status, settings, loadError, saves, actions, retry } = useExtension({ demo });
  const [panel, setPanel] = useState(readPanel);

  useEffect(() => {
    const onHash = () => setPanel(readPanel());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const choose = (id) => {
    setPanel(id);
    const url = `/settings${demo ? '?demo=1' : ''}#${id}`;
    window.history.replaceState({}, '', url);
    document.getElementById('panel-title')?.focus({ preventScroll: true });
  };

  const connected = status.state === 'connected' && settings;
  const current = PANELS.find((p) => p.id === panel);
  const panelProps = { s: settings, saves, set: actions.set, actions };

  return (
    <main id="main" className="settings">
      <div className="container">
        <div className="settings-head">
          <h1 className="settings-title">설정</h1>
          <p className="settings-sub">확장의 설정을 큰 화면에서 정리하는 곳이에요.</p>
        </div>
        <StatusStrip status={status} demo={demo} />

        {!connected ? (
          status.state === 'checking' || (status.state === 'connected' && !loadError) ? (
            <div className="nc nc-wait" aria-busy="true">
              <p>확장에 연결하고 있어요. 3초 안에 답이 없으면 연결 방법을 알려 드려요.</p>
            </div>
          ) : status.state === 'connected' ? (
            <div className="nc">
              <h2 className="nc-title">설정을 불러오지 못했어요</h2>
              <p className="nc-lead">{loadError}</p>
              <div className="nc-actions">
                <button type="button" className="btn btn-action" onClick={retry}>
                  다시 불러오기
                </button>
              </div>
            </div>
          ) : (
            <NotConnected status={status} onRetry={retry} />
          )
        ) : (
          <div className="console">
            <nav className="console-nav" aria-label="설정 메뉴">
              <ul>
                {PANELS.map((p) => (
                  <li key={p.id}>
                    <a
                      href={`#${p.id}`}
                      className="console-link"
                      aria-current={panel === p.id ? 'page' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        choose(p.id);
                      }}
                    >
                      <span className="console-link-label">{p.label}</span>
                      {p.sub && <span className="console-link-sub">{p.sub}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="console-panel">
              <h2 className="panel-title" id="panel-title" tabIndex={-1}>
                {current.label}
              </h2>
              {panel === 'general' && <GeneralPanel {...panelProps} />}
              {panel === 'language' && <LanguagePanel {...panelProps} />}
              {panel === 'me' && <MePanel {...panelProps} />}
              {panel === 'glossary' && <GlossaryPanel {...panelProps} />}
              {panel === 'learned' && <LearnedPanel {...panelProps} />}
              {panel === 'data' && <DataPanel status={status} demo={demo} />}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
