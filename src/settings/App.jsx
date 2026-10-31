import { useEffect, useId, useState } from 'react';
import SaiMark from '../assets/SaiMark.jsx';
import { writeDisplaySetting } from '../lib/displaySettings.js';
import { PREMIUM_DAILY_LIMITS, QUALITY_LABELS } from '../core/refine/quality.js';
import { setOnboardingFields, setProfileSyncingTone, MY_LANGUAGES, PARTNER_REGIONS, DEFAULT_TONES } from '../lib/onboarding.js';
import { removeLearnedPattern, clearLearnedPatterns, SITUATION_TEMPLATES } from '../lib/profile.js';
import { setIdentity, MAX_IDENTITY_FIELD } from '../lib/identity.js';
import {
  addPersonalGlossaryEntry,
  updatePersonalGlossaryEntry,
  removePersonalGlossaryEntry,
  GLOSSARY_LANGUAGES,
} from '../lib/glossary.js';
import { LANGUAGE_LABELS } from '../lib/recipients.js';
import { DIFF_CATEGORIES, LEARNING_THRESHOLD } from '../core/profile/diff.js';
import { flushLearnedDeletions, SYNC_ERRORS } from '../lib/syncClient.js';
import {
  INTEGRATIONS,
  integrationState,
  setIntegrationEnabled,
  addBlockedHost,
  removeBlockedHost,
  hostErrorMessage,
  findIntegration,
  MAX_BLOCKED_HOSTS,
} from '../lib/siteGate.js';
import { useSettingsData } from './useSettingsData.js';

/**
 * 확장 설정 페이지 — `chrome-extension://<id>/src/settings/index.html` (2026-10-25 사용자 결정).
 *
 * 🔴 금지
 *   - 메시지 본문을 보여 주거나 저장하지 않는다. 「데이터」 패널은 **개수만**(`src/lib/localData.js`).
 *   - 새 「전부 지우기」를 만들지 않는다. 지우는 길은 기존 동작(용어 삭제·학습 내역 삭제)과 그 화면 안내뿐이다.
 *   - 웹 브리지(`siteBridge.js`)를 거치지 않는다 — 확장 페이지라 `src/lib/*`를 직접 부른다(같은 규칙·같은 함수).
 *
 * 여는 길: 사이드패널 톱니 → 「자세한 설정」(`chrome.runtime.openOptionsPage`) · chrome://extensions 「확장 프로그램 옵션」
 * (manifest `options_ui`, 탭으로 연다). 패널은 해시(`#general` 등)로 고른다.
 */

const PANELS = [
  { id: 'general', label: '일반', sub: '교정 보기 · 화면' },
  { id: 'activation', label: '켜는 방법·단축키', sub: '사이 버튼 · 단축키' },
  { id: 'integrations', label: '통합', sub: '사이트별 켜고 끄기' },
  { id: 'blocked', label: '표시 안 할 사이트', sub: '사이 버튼 숨기기' },
  // 🔴 id `language`는 그대로 둔다(2026-10-25 이름만 「보내는 글 기본값」으로) — 예전 `#language` 링크가 계속 맞는다.
  { id: 'language', label: '보내는 글 기본값', sub: '상대 지역 · 기본 톤' },
  { id: 'me', label: '나', sub: '내 언어 · 내 정보 · 상황' },
  { id: 'glossary', label: '용어집', sub: '' },
  { id: 'learned', label: '학습 내역', sub: '' },
  { id: 'data', label: '데이터', sub: '이 컴퓨터에 저장된 것' },
  { id: 'plan', label: '요금제', sub: '지금 플랜 · 하루 횟수' },
];

function readPanel() {
  const id = window.location.hash.slice(1);
  return PANELS.some((p) => p.id === id) ? id : 'general';
}

const hasChrome = () => typeof chrome !== 'undefined' && chrome?.runtime?.id != null;

/**
 * 🔴 `chrome://` 주소는 `<a href>`로 열리지 않는다(크롬이 막는다). 확장 페이지·사이드패널은 `chrome.tabs.create`로
 *    열 수 있다 — 사이드패널 단축키 카드가 2026-08-13부터 같은 방법을 쓴다(`src/sidepanel/App.jsx` ShortcutCard, 실확장 확인).
 *    `tabs` 권한 없이도 `create`는 된다(권한은 탭의 URL·제목을 **읽을** 때 필요하다).
 */
async function openTab(url) {
  try {
    await chrome.tabs.create({ url });
    return true;
  } catch {
    return false;
  }
}

/* ── 공통 조각 ─────────────────────────────────────────── */

function Group({ title, note, children, count = null }) {
  return (
    <section className="group">
      <h3 className="group-title">
        {title}
        {count != null && <span className="count num">{count}</span>}
      </h3>
      {note && <p className="group-note">{note}</p>}
      <div className="group-rows">{children}</div>
    </section>
  );
}

function Switch({ checked, onChange, labelledBy, describedBy, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      className="sw"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

function ToggleRow({ label, hint, checked, onChange }) {
  const id = useId();
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
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={`${id}-l`} describedBy={hint ? `${id}-h` : undefined} />
    </div>
  );
}

/** 선택 칩 — 선택됨 = 잉크 채움(A2 §1). `allowNone`이면 「선택 안 함」 칩이 붙는다. */
function Chips({ options, value, onChange, labelledBy, allowNone = false }) {
  const list = allowNone ? [...options, { id: null, label: '선택 안 함' }] : options;
  return (
    <div className="chips" role="radiogroup" aria-labelledby={labelledBy}>
      {list.map((opt) => {
        const on = opt.id === (value ?? null);
        return (
          <button
            key={String(opt.id)}
            type="button"
            role="radio"
            aria-checked={on}
            className="chip"
            onClick={() => !on && onChange(opt.id)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ChoiceRow({ label, hint, options, value, onChange, allowNone = false }) {
  const id = useId();
  return (
    <div className="row row-stack">
      <div className="row-text">
        <span className="row-label" id={`${id}-l`}>
          {label}
        </span>
        {hint && <span className="row-hint">{hint}</span>}
      </div>
      <Chips options={options} value={value} onChange={onChange} labelledBy={`${id}-l`} allowNone={allowNone} />
    </div>
  );
}

function TextRow({ label, hint, value, onSave, placeholder, maxLength }) {
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

/* ── 일반 ─────────────────────────────────────────────── */

/** 다듬기 품질 모드 — 이름만 고른다. 모델은 서버가 정한다(`core/refine/quality.js`, 2026-10-30). */
const QUALITY_OPTIONS = [
  { id: 'fast', label: QUALITY_LABELS.fast, hint: '보통 3초 안에 돌아와요. 처음 설정이에요.' },
  {
    id: 'standard',
    label: QUALITY_LABELS.standard,
    hint: `보통 4초 안팎이에요. 하루 ${PREMIUM_DAILY_LIMITS.standard}번까지 쓰고, 넘으면 빠른 모드로 다듬어요.`,
  },
  {
    id: 'deep',
    label: QUALITY_LABELS.deep,
    hint: `보통 10초쯤 걸리는 대신 가장 꼼꼼해요. 하루 ${PREMIUM_DAILY_LIMITS.deep}번까지 쓰고, 넘으면 빠른 모드로 다듬어요.`,
  },
];

function GeneralPanel({ data, act }) {
  const d = data.display;
  const toggle = (field) => (next) => act(() => writeDisplaySetting(field, next));
  return (
    <>
      <Group
        title="메시지가 바뀌는 설정"
        note="상대에게 나가는 문장이 달라져요. 여기는 기본값이고, 이번 한 번만 바꾸려면 교정 팝업에서 끄고 켤 수 있어요."
      >
        <ToggleRow
          label="직전 대화 참고"
          hint="같은 화면의 직전 메시지 최대 5개를 함께 보내 문맥에 맞게 다듬어요. 다른 사람이 쓴 메시지가 포함될 수 있고, 그 내용은 저장하지 않아요."
          checked={d.threadContext}
          onChange={toggle('threadContext')}
        />
      </Group>

      <Group
        title="다듬기 품질"
        note="빠를수록 기다림이 짧고, 심층일수록 숫자·용어·말투를 더 꼼꼼히 지켜요. 다듬을 때마다 이 모드를 써요."
      >
        <span className="sr-only" id="quality-l">다듬기 품질 모드</span>
        <Chips options={QUALITY_OPTIONS} value={d.quality} onChange={(next) => act(() => writeDisplaySetting('quality', next))} labelledBy="quality-l" />
        <p className="row-hint quality-hint">{QUALITY_OPTIONS.find((o) => o.id === d.quality)?.hint}</p>
      </Group>

      <Group title="문장을 넣을 때" note="다듬은 문장·저장 문구를 입력창에 넣는 방식이에요.">
        <ToggleRow
          label="저장 문구를 뒤에 이어 붙이기"
          hint="끄면 입력창의 기존 내용을 지우고 넣어요."
          checked={d.snippetInsertMode === 'append'}
          onChange={(next) => act(() => writeDisplaySetting('snippetInsertMode', next ? 'append' : 'replace'))}
        />
        <ToggleRow
          label="회신 초안 바로 만들기"
          hint="받은 메시지에 회신 방향을 고르면 질문 없이 바로 초안을 만들어요. 끄면 초안의 빈칸을 줄이는 질문을 먼저 해요."
          checked={d.replyAuto}
          onChange={toggle('replyAuto')}
        />
      </Group>

      <Group title="교정을 보는 방법" note="나가는 문장은 그대로예요. 내가 확인하는 방식만 달라져요.">
        <ToggleRow
          label="역번역 보기"
          hint="다듬은 문장이 상대에게 어떻게 읽히는지 내 언어로 되돌려 보여 줘요."
          checked={d.backTranslation}
          onChange={toggle('backTranslation')}
        />
        <ToggleRow
          label="변경 이유 보기"
          hint="무엇을 왜 바꿨는지, 원문의 기한·숫자가 그대로 남았는지 대조한 내용을 펼쳐 둬요."
          checked={d.refineReasoning}
          onChange={toggle('refineReasoning')}
        />
        <ToggleRow
          label="색 표시 설명"
          hint="초록·노란 표시가 무슨 뜻인지 알려 줘요. 표시 자체는 항상 켜져 있어요."
          checked={d.highlightHints}
          onChange={toggle('highlightHints')}
        />
        <ToggleRow
          label="참고한 대화 미리보기"
          hint="직전 대화 참고가 켜져 있을 때, 팝업에 참고한 메시지를 보여 줘요. 끄면 화면에서만 가리고 참고는 그대로 해요."
          checked={d.threadContextPreview}
          onChange={toggle('threadContextPreview')}
        />
      </Group>

      <Group title="화면">
        <ToggleRow
          label="다크 모드"
          hint="사이드 패널·페이지 팝업·이 설정 페이지에 함께 적용돼요."
          checked={d.theme === 'dark'}
          onChange={(next) => act(() => writeDisplaySetting('theme', next ? 'dark' : 'light'))}
        />
      </Group>
    </>
  );
}

/* ── 켜는 방법·단축키 ─────────────────────────────────── */

/**
 * 🔴 크롬은 예약 명령(`_execute_action`)의 description을 돌려주지 않는다(2026-08-15 실확장) — 우리 라벨로 덮는다.
 * 🔴 매니페스트 제안값(Alt+S 등)을 하드코딩하지 않는다 — 다른 확장과 겹치면 크롬이 **조용히 비워 둔다**
 *    (`src/manifest.js` commands 주석). 실제 값을 읽어 비었으면 「지정 안 됨」으로 보여 준다.
 */
const COMMAND_INFO = {
  _execute_action: { label: '사이드 패널 열기', what: '홈·팀·보관함·프로필이 있는 사이드 패널을 열어요.' },
  'refine-selection': {
    label: '선택한 문장 다듬기 / 뜻 풀기',
    what: '선택한 글이 내가 쓴 문장이면 다듬고, 받은 메시지면 뜻을 풀어요.',
  },
  'open-snippets': { label: '저장 문구 열기', what: '저장해 둔 문구 목록을 입력창 옆에 띄워요.' },
};

function useCommands() {
  const [commands, setCommands] = useState(null);
  useEffect(() => {
    if (!hasChrome() || !chrome.commands?.getAll) {
      setCommands([]);
      return;
    }
    chrome.commands
      .getAll()
      .then(setCommands)
      .catch(() => setCommands([]));
  }, []);
  return commands;
}

function ActivationPanel({ toast }) {
  const commands = useCommands();
  return (
    <>
      <Group title="사이 버튼" note="웹페이지에서 문장을 드래그해 선택하면 그 옆에 사이 버튼이 떠요.">
        <div className="demo" aria-hidden="true">
          <p className="demo-line">
            Could you <mark className="demo-sel">send the report by Friday?</mark>
          </p>
          <span className="demo-fab">
            <SaiMark size={28} />
          </span>
        </div>
        <ol className="steps">
          <li>
            <b>문장 선택</b> — 입력창에 쓴 문장이나 받은 메시지를 드래그해요.
          </li>
          <li>
            <b>사이 버튼 누르기</b> — 세 줄 모양 버튼이에요. 내가 쓴 문장은 다듬고, 받은 메시지는 뜻을 풀어요.
          </li>
          <li>
            <b>적용하기</b> — 다듬은 문장을 확인하고 입력창에 넣어요. 사이가 대신 보내지는 않아요.
          </li>
        </ol>
        <p className="group-note">
          특정 사이트에서 버튼이 뜨지 않게 하려면 <a href="#blocked">표시 안 할 사이트</a>나 <a href="#integrations">통합</a>
          에서 꺼요. 꺼 둔 사이트에서도 단축키로는 쓸 수 있어요.
        </p>
      </Group>

      <Group title="도구 모음 아이콘" note="브라우저 오른쪽 위의 사이 아이콘을 누르면 사이드 패널이 열려요. 퍼즐 조각 메뉴에서 고정해 두면 찾기 쉬워요." />

      <Group title="단축키" note="다른 확장이나 프로그램과 겹치면 크롬이 그 칸을 비워 둬요. 「단축키 변경」에서 직접 지정할 수 있어요.">
        {commands === null ? (
          <p className="empty">단축키를 불러오는 중…</p>
        ) : commands.length === 0 ? (
          <p className="empty">이 화면에서는 단축키를 읽을 수 없어요. 확장 안에서 열어 주세요.</p>
        ) : (
          <ul className="keys">
            {commands.map((command) => {
              const info = COMMAND_INFO[command.name];
              return (
                <li key={command.name} className="key-row">
                  <div className="row-text">
                    <span className="row-label">{info?.label || command.description || command.name}</span>
                    {info?.what && <span className="row-hint">{info.what}</span>}
                  </div>
                  {command.shortcut ? (
                    <kbd className="kbd">{command.shortcut}</kbd>
                  ) : (
                    // 🔴 빈 값을 숨기지 않는다 — 미할당이라는 사실이 곧 알아야 할 정보다.
                    <span className="kbd-none">지정 안 됨</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="actions">
          <button
            type="button"
            className="btn primary press"
            onClick={async () => {
              if (!(await openTab('chrome://extensions/shortcuts'))) {
                toast('주소창에 chrome://extensions/shortcuts 를 입력해 주세요');
              }
            }}
          >
            단축키 변경
          </button>
        </div>
      </Group>
    </>
  );
}

/* ── 통합 ─────────────────────────────────────────────── */

function IntegrationsPanel({ data, act }) {
  return (
    <Group
      title="자주 쓰는 업무 사이트"
      note="끄면 그 사이트에서 문장을 선택해도 사이 버튼이 뜨지 않아요. 단축키(Alt+D 등)로는 그대로 쓸 수 있어요. 여기 없는 사이트도 기본으로 켜져 있어요 — 끄려면 「표시 안 할 사이트」에 넣어요."
    >
      <ul className="integrations">
        {INTEGRATIONS.map((item) => {
          const state = integrationState(item, data.sites);
          const id = `int-${item.id}`;
          return (
            <li key={item.id} className="integration">
              <div className="row-text">
                <span className="row-label" id={`${id}-l`}>
                  {item.name}
                </span>
                <span className="row-hint" id={`${id}-h`}>
                  {item.description}
                </span>
                {state.blockedBy && (
                  <span className="row-warn">
                    「표시 안 할 사이트」의 <b>{state.blockedBy}</b> 때문에 버튼이 숨겨져 있어요. 그 목록에서 빼야 다시 떠요.
                  </span>
                )}
                <a className="ext-link" href={item.openUrl} target="_blank" rel="noopener noreferrer">
                  {item.name}에서 열기 ↗
                </a>
              </div>
              <Switch
                checked={state.on}
                labelledBy={`${id}-l`}
                describedBy={`${id}-h`}
                onChange={(next) => act(() => setIntegrationEnabled(item.id, next), next ? `${item.name} 켰어요` : `${item.name} 껐어요`)}
              />
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

/* ── 표시 안 할 사이트 ────────────────────────────────── */

function BlockedPanel({ data, act }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();
  const list = data.sites.blocked;

  const submit = async (e) => {
    e.preventDefault();
    const result = await addBlockedHost(draft);
    if (!result.ok) {
      setError(result.reason === 'full' ? `최대 ${MAX_BLOCKED_HOSTS}개까지 넣을 수 있어요.` : hostErrorMessage(result.reason));
      return;
    }
    setError('');
    setDraft('');
    // 저장은 위에서 끝났다 — 다시 읽고 알리기만 한다.
    act(async () => {}, result.duplicate ? `${result.host}는 이미 목록에 있어요` : `${result.host}에서 사이 버튼을 숨겨요`);
  };

  return (
    <>
      <Group
        title="사이트 추가"
        note="여기 넣은 사이트와 그 하위 도메인에서는 문장을 선택해도 사이 버튼이 뜨지 않아요. 단축키(Alt+D 등)로는 그대로 쓸 수 있어요. 주소를 붙여 넣으면 사이트 이름만 남겨요."
      >
        <form className="add-host" onSubmit={submit} noValidate>
          <label className="sr-only" htmlFor={inputId}>
            사이트 주소
          </label>
          <input
            id={inputId}
            className="field-input"
            value={draft}
            placeholder="예: example.com"
            maxLength={300}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${inputId}-e` : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError('');
            }}
          />
          <button type="submit" className="btn primary press" disabled={draft.trim() === ''}>
            추가
          </button>
        </form>
        {error && (
          <p className="field-error" id={`${inputId}-e`} role="alert">
            {error}
          </p>
        )}
      </Group>

      <Group title="숨긴 사이트" count={list.length}>
        {list.length === 0 ? (
          <p className="empty">아직 없어요. 사이 버튼이 방해되는 사이트가 있으면 위에 넣어 주세요.</p>
        ) : (
          <ul className="hosts">
            {list.map((host) => {
              const integration = findIntegration(host);
              return (
                <li key={host} className="host-row">
                  <div className="row-text">
                    <span className="row-label host-name">{host}</span>
                    <span className="row-hint">
                      하위 도메인 포함{integration ? ` · 통합의 ${integration.name}보다 우선해요` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn sm press"
                    aria-label={`${host} 목록에서 빼기`}
                    onClick={() => act(() => removeBlockedHost(host), `${host}에서 다시 사이 버튼을 보여 줘요`)}
                  >
                    빼기
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Group>
    </>
  );
}

/* ── 보내는 글 기본값 (예전 「언어와 톤」) ─────────────────
 * 🔴 2026-10-25 사용자 결정 — 「나에 대한 사실」(내 언어 → 「나」 패널)과 「사이가 보내는 글을 어떻게 쓰나」(여기)를 나눈다.
 *    한 화면에 같은 값을 두 번 두지 않는다. 저장 키는 그대로(`sai.onboarding`). */

const pick = (list) => list.map(({ id, label }) => ({ id, label }));

function LanguagePanel({ data, act }) {
  const o = data.onboarding;
  const set = (patch) => act(() => setOnboardingFields(patch));
  return (
    <Group
      title="상대와 말투"
      note="사이가 상대에게 나가는 문장을 쓸 때의 기본값이에요. 바꾸면 다음 교정부터 적용돼요. 내 언어는 「나」에 있어요."
    >
      <ChoiceRow
        label="상대 지역"
        hint="상대에게 보낼 언어의 기본값을 정하는 데만 써요. 상대의 성향이나 말투를 짐작하는 데 쓰지 않아요. 사람마다 다르면 사이드 패널 프로필의 「내가 대화하는 사람들」에서 정해요."
        options={pick(PARTNER_REGIONS)}
        value={o.partnerRegion ?? null}
        allowNone
        onChange={(next) => set({ partnerRegion: next })}
      />
      <ChoiceRow
        label="기본 톤"
        hint="따로 정하지 않았을 때 다듬는 말투예요. 교정에서 가장 먼저 따르는 기준(1순위)이에요."
        options={pick(DEFAULT_TONES)}
        value={o.tone ?? null}
        onChange={(next) => set({ tone: next })}
      />
    </Group>
  );
}

/* ── 나 ───────────────────────────────────────────────── */

function MePanel({ data, act }) {
  return (
    <>
      <Group title="내 정보" note="이름과 직급은 팀에서 나를 알아보게 하는 값이에요. 팀을 만들거나 참가할 때만 함께 보내고, 교정 문장에는 쓰이지 않아요.">
        <ChoiceRow
          label="내 언어"
          hint="내가 쓰고 읽는 언어예요. 역번역과 뜻 풀기가 이 언어로 나와요."
          options={pick(MY_LANGUAGES)}
          value={data.onboarding.language ?? null}
          onChange={(next) => act(() => setOnboardingFields({ language: next }))}
        />
        <TextRow
          label="표시 이름"
          value={data.identity.displayName}
          placeholder="예: 김사이"
          maxLength={MAX_IDENTITY_FIELD}
          onSave={(next) => act(() => setIdentity({ displayName: next }))}
        />
        <TextRow
          label="직급"
          value={data.identity.jobTitle}
          placeholder="예: 백엔드 개발자"
          maxLength={MAX_IDENTITY_FIELD}
          onSave={(next) => act(() => setIdentity({ jobTitle: next }))}
        />
      </Group>
      <Group
        title="상황"
        note="교정에서 가장 먼저 따르는 기준이에요. 상대가 어느 나라 사람인지보다 지금 어떤 일을 하는지를 먼저 봅니다. 말투는 「보내는 글 기본값」의 기본 톤에서 정해요."
      >
        {/* 🔴 「협업 성향」 칩을 뺐다(2026-10-25 사용자 결정) — 말투는 「기본 톤」 하나다(같은 축, 저장 키는 그대로 동기화). */}
        <ChoiceRow
          label="자주 쓰는 상황"
          options={pick(SITUATION_TEMPLATES)}
          value={data.profile.situationId ?? null}
          allowNone
          onChange={(next) => act(() => setProfileSyncingTone({ situationId: next }))}
        />
      </Group>
    </>
  );
}

/* ── 용어집 ────────────────────────────────────────────── */

const GLOSSARY_LANGS = GLOSSARY_LANGUAGES.map((id) => ({ id, label: LANGUAGE_LABELS[id] ?? id }));

function languageLabel(id) {
  if (id == null) return '모든 언어';
  return GLOSSARY_LANGS.find((o) => o.id === id)?.label ?? id;
}

function GlossaryEditor({ initial, onSubmit, onCancel, submitLabel }) {
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
        <input id={ids.s} className="field-input" value={sourceText} maxLength={200} placeholder="예: 배포" onChange={(e) => setSource(e.target.value)} />
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
        <select id={ids.l} className="field-select" value={language ?? ''} onChange={(e) => setLanguage(e.target.value || null)}>
          <option value="">모든 언어</option>
          {GLOSSARY_LANGS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="gl-field gl-field-keep">
        <span id={ids.k}>원문 유지</span>
        <Switch checked={keepSource} onChange={setKeep} labelledBy={ids.k} />
      </div>
      <div className="gl-actions">
        <button type="submit" className="btn sm primary press" disabled={!canSubmit}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn sm press" onClick={onCancel}>
            취소
          </button>
        )}
      </div>
    </form>
  );
}

function GlossaryPanel({ data, act }) {
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const list = data.glossary;

  return (
    <>
      <Group
        title="용어 추가"
        note="교정할 때 이 말은 이렇게 옮겨요. 「원문 유지」를 켜면 제품 이름처럼 번역하지 않고 그대로 둬요. 같은 원문·같은 언어로 다시 넣으면 새 값으로 바뀌어요."
      >
        <GlossaryEditor submitLabel="추가" onSubmit={(entry) => act(() => addPersonalGlossaryEntry(entry), '용어를 저장했어요')} />
      </Group>

      <Group title="등록한 용어" count={list.length} note="팀 용어집은 사이드 패널 보관함의 「팀」에서 관리해요.">
        {list.length === 0 ? (
          <p className="empty">아직 등록한 용어가 없어요. 위에서 자주 쓰는 말을 하나 추가해 보세요.</p>
        ) : (
          <table className="gl-table">
            <thead>
              <tr>
                <th scope="col">원문</th>
                <th scope="col">바꿀 말</th>
                <th scope="col">언어</th>
                <th scope="col">
                  <span className="sr-only">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) =>
                editing === item.id ? (
                  <tr key={item.id} className="gl-editing">
                    <td colSpan={4}>
                      <GlossaryEditor
                        initial={item}
                        submitLabel="저장"
                        onCancel={() => setEditing(null)}
                        onSubmit={async (patch) => {
                          const ok = await act(() => updatePersonalGlossaryEntry(item.id, patch), '용어를 고쳤어요');
                          if (ok) setEditing(null);
                          return ok;
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={item.id}>
                    <td data-label="원문">
                      <span className="gl-source">{item.sourceText}</span>
                    </td>
                    <td data-label="바꿀 말">{item.keepSource ? <span className="gl-muted">원문 그대로</span> : item.targetText}</td>
                    <td data-label="언어">{languageLabel(item.language)}</td>
                    <td className="gl-row-actions">
                      {confirming === item.id ? (
                        <span className="confirm-inline">
                          <span>삭제할까요?</span>
                          <button
                            type="button"
                            className="btn sm danger-solid press"
                            onClick={async () => {
                              await act(() => removePersonalGlossaryEntry(item.id), '용어를 삭제했어요');
                              setConfirming(null);
                            }}
                          >
                            삭제
                          </button>
                          <button type="button" className="btn sm press" onClick={() => setConfirming(null)}>
                            취소
                          </button>
                        </span>
                      ) : (
                        <>
                          {/* 🔴 작은 버튼 (2026-10-27 사용자 승인 C) — 밑줄 글자 둘이 나란히 붙어 구분이 안 됐다. 삭제는 경고색. */}
                          <button type="button" className="btn sm press" onClick={() => setEditing(item.id)}>
                            수정
                          </button>
                          <button type="button" className="btn sm danger press" onClick={() => setConfirming(item.id)}>
                            삭제
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </Group>
    </>
  );
}

/* ── 학습 내역 ─────────────────────────────────────────── */

/**
 * 🔴 **서버 쪽도 바로 지운다** — 사이드패널 `deleteOnServer`(`src/sidepanel/App.jsx`)와 같은 판정(L22).
 * | 결과 | 문구 |
 * |---|---|
 * | 지움(또는 지울 것 없음) | 「서버 기록도 지웠어요」 |
 * | 로그인 안 함 | 「이 컴퓨터에서 지웠어요」 — 서버에 올린 적이 없다 |
 * | 그 밖의 실패 | 「서버 기록은 다음 동기화 때 지워요」 — 대기 목록에 남아 다음 동기화가 병합 전에 지운다 |
 */
async function flushServerDeletion() {
  try {
    await flushLearnedDeletions();
    return ' — 서버 기록도 지웠어요';
  } catch (error) {
    return error?.reason === SYNC_ERRORS.NOT_SIGNED_IN ? ' — 이 컴퓨터에서 지웠어요' : ' — 서버 기록은 다음 동기화 때 지워요';
  }
}

function LearnedPanel({ data, act, toast }) {
  const [confirmAll, setConfirmAll] = useState(false);
  const counts = data.learned;
  const rows = DIFF_CATEGORIES.filter((c) => (counts[c.id] ?? 0) > 0);

  const remove = async (id) => {
    const ok = await act(() => removeLearnedPattern(id), null);
    if (ok) toast(`학습 내역 1건을 삭제했어요${await flushServerDeletion()}`);
  };
  const clear = async () => {
    const ok = await act(() => clearLearnedPatterns(), null);
    if (ok) {
      setConfirmAll(false);
      toast(`학습 내역을 모두 삭제했어요${await flushServerDeletion()}`);
    }
  };

  return (
    <Group
      title="내 수정 습관"
      count={rows.length}
      note={`다듬은 문장을 내가 다시 고쳐 쓰면, 어떤 종류의 수정이었는지 횟수만 셉니다. 문장은 저장하지 않아요. 같은 종류가 ${LEARNING_THRESHOLD}번 이상 쌓이면 다음 교정에 반영돼요.`}
    >
      {rows.length === 0 ? (
        <p className="empty">아직 쌓인 학습 내역이 없어요.</p>
      ) : (
        <>
          <ul className="learned-list">
            {rows.map((c) => {
              const n = counts[c.id];
              return (
                <li key={c.id} className="learned-row">
                  <div className="row-text">
                    <span className="row-label">{c.label}</span>
                    <span className="row-hint num">
                      {n}회 · {n >= LEARNING_THRESHOLD ? '교정에 반영 중' : `${LEARNING_THRESHOLD}회부터 반영`}
                    </span>
                  </div>
                  <button type="button" className="btn sm press" onClick={() => remove(c.id)} aria-label={`${c.label} 학습 내역 삭제`}>
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
                  학습 내역 {rows.length}가지를 모두 지워요. 로그인해 동기화한 적이 있다면 서버 기록도 함께 지웁니다. 되돌릴 수
                  없어요.
                </p>
                <div className="confirm-actions">
                  <button type="button" className="btn sm danger-solid press" onClick={clear}>
                    전체 삭제
                  </button>
                  <button type="button" className="btn sm press" onClick={() => setConfirmAll(false)}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="link-button" onClick={() => setConfirmAll(true)}>
                전체 삭제
              </button>
            )}
          </div>
        </>
      )}
    </Group>
  );
}

/* ── 데이터 ────────────────────────────────────────────── */

async function openSidePanel() {
  // 🔴 `sidePanel.open`은 사용자 동작(클릭) 안에서만 된다. 실패하면 아이콘을 누르라고 안내한다.
  const win = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: win.id });
}

function DataPanel({ data, toast }) {
  const s = data.summary;
  const side = (where) => ({ kind: 'side', where });
  const rows = [
    { label: '개인 용어', value: s.glossary, unit: '개', go: { kind: 'hash', id: 'glossary' } },
    { label: '학습 내역(수정 습관 종류)', value: s.learned, unit: '가지', go: { kind: 'hash', id: 'learned' } },
    { label: '저장 문구', value: s.snippets, unit: '개', go: side('보관함') },
    { label: '예약 기록', value: s.reservations, unit: '개', go: side('보관함') },
    { label: '대화하는 사람(수신자)', value: s.recipients, unit: '명', go: side('프로필') },
    { label: '결정 로그', value: s.decisionLogs, unit: '개', go: { kind: 'decisions' } },
    { label: '소속 팀', value: s.teams, unit: '개', go: side('팀') },
    { label: '표시 안 할 사이트', value: s.blockedSites, unit: '개', go: { kind: 'hash', id: 'blocked' } },
    { label: '꺼 둔 통합', value: s.integrationsOff, unit: '개', go: { kind: 'hash', id: 'integrations' } },
  ];

  const goLabel = (go) => {
    if (go.kind === 'hash') return `${PANELS.find((p) => p.id === go.id)?.label}에서 보기`;
    if (go.kind === 'decisions') return '결정 로그 열기';
    return `사이드 패널 › ${go.where}`;
  };
  const follow = async (go) => {
    if (go.kind === 'hash') {
      window.location.hash = go.id;
      return;
    }
    if (go.kind === 'decisions') {
      if (!hasChrome() || !(await openTab(chrome.runtime.getURL('src/decisions/index.html')))) {
        toast('결정 로그를 열지 못했어요');
      }
      return;
    }
    try {
      await openSidePanel();
    } catch {
      toast(`도구 모음의 사이 아이콘을 눌러 사이드 패널을 연 뒤 「${go.where}」 탭에서 볼 수 있어요`);
    }
  };

  return (
    <>
      <p className="zr">
        <span className="zr-dot" aria-hidden="true" />
        <span>
          <b>Zero Retention</b> — 다듬을 메시지 본문은 서버·로그에 남기지 않아요. 아래는 이 컴퓨터의 확장 저장소에 있는 것의{' '}
          <b>개수</b>예요.
        </span>
      </p>

      <Group title="이 컴퓨터에 저장된 것" note="내용은 여기서 보여 주지 않아요. 보거나 지우려면 오른쪽 링크의 화면으로 가요.">
        <ul className="data-list">
          {rows.map((row) => (
            <li key={row.label} className="data-row">
              <span className="data-label">{row.label}</span>
              <span className="data-value num">
                {row.value}
                <span className="data-unit">{row.unit}</span>
              </span>
              <button type="button" className="link-button" onClick={() => follow(row.go)}>
                {goLabel(row.go)}
              </button>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="연결 상태">
        <dl className="conn">
          <div>
            <dt>구글 로그인</dt>
            <dd>{data.signedIn ? '로그인함' : '로그인 안 함'}</dd>
          </div>
          <div>
            <dt>결정 로그 저장 동의</dt>
            <dd>{s.decisionsConsent ? '동의함' : '동의 안 함'}</dd>
          </div>
          <div>
            <dt>서버에서 지울 학습 내역</dt>
            <dd>{s.pendingLearnedDeletions ? '대기 중' : '없음'}</dd>
          </div>
          <div>
            <dt>확장 버전</dt>
            <dd className="num">{hasChrome() ? chrome.runtime.getManifest().version : '알 수 없음'}</dd>
          </div>
        </dl>
        <p className="group-note">
          로그인·동기화·계정 삭제는 사이드 패널의 설정(톱니)에 있어요. 마지막 동기화 시각은 저장하지 않아 보여 드릴 수 없어요.
        </p>
      </Group>
    </>
  );
}

/* ── 요금제 ───────────────────────────────────────────── */

/**
 * 요금제 (L36, 2026-10-29 사용자 결정 — Spec §0 수익화). 표·비교는 소개 사이트 `/pricing`에만 두고 여기는 지금 상태와 링크만.
 * 🔴 숫자를 두 곳에 늘리지 않는다 — 하루 100회는 `functions/refineQuota.js` DAILY_REFINE_LIMIT(서울 날짜 경계).
 * 🔴 오늘 쓴 횟수는 보여 주지 않는다(2026-10-29 사용자 결정).
 * 🔴 `PRODUCTION_SITE_URL`(src/config.js)은 externally_connectable을 정하므로 여기서 쓰지 않는다 — 링크 주소만 따로 둔다.
 */
const PRICING_URL = 'https://sai-global-msg-2026.web.app/pricing';

function PlanPanel() {
  return (
    <>
      <Group title="지금 플랜" note="출시 기간에는 개인 기능과 팀 기능을 모두 무료로 써요. 결제 수단을 등록하는 곳도 없어요.">
        <dl className="conn">
          <div>
            <dt>플랜</dt>
            <dd>무료 · 출시 기간</dd>
          </div>
          <div>
            <dt>하루 횟수</dt>
            <dd className="num">100회</dd>
          </div>
        </dl>
        <p className="group-note">
          하루 횟수는 다듬기 · 뜻 풀기 · 회신 초안을 합쳐 세요. 다 쓰면 다음 날(한국 시간 자정) 다시 채워지고, 저장 문구 ·
          용어집 · 예약 알림은 그대로 쓸 수 있어요.
        </p>
      </Group>

      <Group title="유료 플랜" note="개인 Pro(연 결제 시 월 $4 · 월 결제 $6 예정)와 팀 플랜을 준비하고 있어요. 유료 플랜이 나와도 무료 플랜은 남아요.">
        <a className="btn press plan-link" href={PRICING_URL} target="_blank" rel="noopener noreferrer">
          요금제 자세히 보기
        </a>
      </Group>
    </>
  );
}

/* ── 페이지 ────────────────────────────────────────────── */

export default function App() {
  const { data, error, reload } = useSettingsData();
  const [panel, setPanel] = useState(readPanel);
  const [toastText, setToastText] = useState('');

  useEffect(() => {
    const onHash = () => {
      setPanel(readPanel());
      document.getElementById('panel-title')?.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 🔴 테마 — 저장값이 없으면 라이트(사이드패널·팝업과 같은 기본값, 2026-08-20). OS 설정을 보지 않는다.
  const theme = data?.display?.theme ?? 'light';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!toastText) return undefined;
    const timer = setTimeout(() => setToastText(''), 2600);
    return () => clearTimeout(timer);
  }, [toastText]);

  /**
   * 저장 한 번. 성공하면 다시 읽고(다른 화면의 규칙 — 톤↔프로필 연결 등 — 이 적용된 값을 보여 주려고) 토스트.
   * 🔴 실패 사유를 화면에 그대로 싣지 않는다 — 라이브러리 검증 문구(한국어, 값 없음)만 보여 준다.
   * @returns {Promise<boolean>}
   */
  const act = async (fn, message = '저장했어요') => {
    try {
      await fn();
      await reload();
      if (message) setToastText(message);
      return true;
    } catch (caught) {
      const text = caught instanceof Error && /[가-힣]/.test(caught.message) ? caught.message : '저장하지 못했어요';
      setToastText(text);
      return false;
    }
  };

  const choose = (id) => {
    if (window.location.hash.slice(1) === id) return;
    window.location.hash = id;
  };

  const current = PANELS.find((p) => p.id === panel);
  const props = { data, act, toast: setToastText };

  return (
    <div className="page">
      <header className="head">
        <span className="brand">
          <SaiMark size={34} />
          <span className="brand-name">S·AI</span>
          <span className="brand-sub">설정</span>
        </span>
        <span className="head-note">바꾸면 바로 저장되고, 열려 있는 사이드 패널·팝업에도 적용돼요.</span>
      </header>

      {error && !data ? (
        <div className="nc">
          <h2 className="nc-title">설정을 불러오지 못했어요</h2>
          <p className="nc-lead">확장을 다시 로드한 뒤 이 페이지를 새로 열어 주세요.</p>
          <button type="button" className="btn primary press" onClick={reload}>
            다시 불러오기
          </button>
        </div>
      ) : !data ? (
        <p className="loading" aria-busy="true">
          불러오는 중…
        </p>
      ) : (
        <div className="console">
          <nav className="console-nav" aria-label="설정 메뉴">
            <ul>
              {PANELS.map((p) => (
                <li key={p.id}>
                  <a
                    href={`#${p.id}`}
                    className="console-link press"
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
          <main className="console-panel">
            <h1 className="panel-title" id="panel-title" tabIndex={-1}>
              {current.label}
            </h1>
            <div className="panel-body" key={panel}>
              {panel === 'general' && <GeneralPanel {...props} />}
              {panel === 'activation' && <ActivationPanel {...props} />}
              {panel === 'integrations' && <IntegrationsPanel {...props} />}
              {panel === 'blocked' && <BlockedPanel {...props} />}
              {panel === 'language' && <LanguagePanel {...props} />}
              {panel === 'me' && <MePanel {...props} />}
              {panel === 'glossary' && <GlossaryPanel {...props} />}
              {panel === 'learned' && <LearnedPanel {...props} />}
              {panel === 'data' && <DataPanel {...props} />}
              {panel === 'plan' && <PlanPanel />}
            </div>
          </main>
        </div>
      )}

      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </div>
  );
}
