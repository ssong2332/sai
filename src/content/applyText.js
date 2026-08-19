/**
 * 심리스 교체 (S07 / Spec 필수 5) — 승인한 문장을 **원래 입력창에 직접 넣는다.**
 *
 * 🔴 Lessons #2 (구 T47/T49 스파이크 실측):
 *    - contentEditable에 `textContent` 대입은 **조용히 실패하거나 서식을 파괴한다.**
 *      리치 에디터(Gmail 등)는 Range / `execCommand('insertText')` 기반 삽입이 필요하다.
 *    - **본문 전체를 치환하면 인용문이 날아간다.** 그래서 이 모듈은 언제나 **선택 구간만**
 *      바꾼다. 에디터 전체를 건드리는 경로를 두지 않는다.
 * 🔴 Spec 필수 5: DOM 교체가 실패하면 클립보드 복사로 폴백하고 사용자에게 알린다.
 *    조용히 실패해서 사용자가 원문을 그대로 보내는 것이 최악이다.
 * 🔴 Zero Retention: 이 파일은 본문을 로그·저장소에 쓰지 않는다.
 */

/**
 * 폼 필드 값을 **프레임워크가 알아채도록** 되돌린다 (S24 / Spec 부가 1).
 *
 * 🔴 `el.value = x`만 하면 **React가 변경을 감지하지 못한다** — 내부 value tracker가 네이티브
 *    setter를 통한 변경만 인정한다(이 프로젝트가 이미 겪은 함정: `docs/Tasks.md` S12 기록).
 *    네이티브 setter로 값을 넣고 `input` 이벤트를 태워야 되돌리기가 화면에도 반영된다.
 */
function setFormValue(element, value) {
  const proto =
    element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  element.focus();
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * contentEditable 되돌리기 (S24 / Spec 부가 1).
 *
 * 🔴 **먼저 `execCommand('undo')`를 시도하고, 실제로 원래대로 왔는지 확인한다.** 서식을 지키는
 *    유일한 방법이 에디터 자신의 undo 스택을 되감는 것이라 이걸 1순위로 둔다(Lessons #2 —
 *    `textContent` 대입은 서식을 파괴한다). Gmail은 이 경로로 정상 복원된다(2026-08-14 실측).
 *
 * 🔴 **그런데 에디터가 자기 히스토리를 따로 관리하면 undo가 엉뚱하게 동작한다** — ChatGPT
 *    (ProseMirror 계열)에서 실측한 결과, 넣은 문장이 지워지지 않은 채 **원문이 뒤에 덧붙어**
 *    되돌리기 전보다 더 망가졌다(2026-08-14 사용자 보고). 그래서 **결과를 검증하고, 실패했으면
 *    스냅샷으로 직접 되돌린다.** 되돌리기가 내용을 더 망가뜨리는 것은 최악이다.
 *
 * 🔴 2순위 복원은 서식이 단순화될 수 있다(선택 전체를 평문으로 다시 넣는다). 그럼에도 이 편이
 *    나은 이유: 여기 도달했다는 건 이미 에디터의 undo가 실패해 **내용이 어긋나 있다**는 뜻이고,
 *    그 상태를 그대로 두는 것보다 텍스트라도 정확히 맞추는 편이 낫다.
 *
 * @returns {boolean} 원래 내용으로 복원되었으면 true. false면 호출자가 사용자에게 알린다.
 */
function undoContentEditable(editable, snapshotText) {
  editable.focus();

  // 1순위 — 에디터 자신의 undo(서식 보존).
  try {
    document.execCommand('undo');
  } catch {
    // 막아둔 에디터 — 아래 2순위로.
  }
  if (editable.textContent === snapshotText) return true;

  // 2순위 — 스냅샷으로 직접 복원.
  try {
    const selection = window.getSelection();
    const all = document.createRange();
    all.selectNodeContents(editable);
    selection?.removeAllRanges();
    selection?.addRange(all);
    document.execCommand('insertText', false, snapshotText);
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: snapshotText }));
  } catch {
    return false;
  }
  return editable.textContent === snapshotText;
}

/** 적용 결과 — 호출자가 토스트 문구를 고르는 데 쓴다. */
export const APPLY_METHOD = {
  /** `<textarea>`/`<input>` 직접 치환. */
  FORM_FIELD: 'form-field',
  /** contentEditable에 `insertText`로 삽입 (undo 스택 보존). */
  INSERT_TEXT: 'insert-text',
  /** contentEditable에 Range 조작으로 삽입 (insertText가 안 먹은 경우). */
  RANGE: 'range',
  /** DOM 교체 실패 → 클립보드 복사 폴백. */
  CLIPBOARD: 'clipboard',
  /** 클립보드까지 실패. */
  FAILED: 'failed',
};

/**
 * 교정문을 대상에 적용한다.
 *
 * @param {object} params
 * @param {Element|null} params.target 교정을 건 시점의 입력 요소.
 * @param {Range|null} params.range 문서 선택이었던 경우의 원래 Range(팝업 클릭으로 소실되므로 미리 복제해 둔 것).
 * @param {string} params.text 넣을 문장.
 * @param {'replace'|'append'} [params.mode] 'append'면 기존 내용을 지우지 않고 뒤에 붙인다
 *   (S20 후속 — 저장 문구 삽입에서만 쓴다. 교정문 적용은 언제나 선택 구간 치환이다).
 * @returns {Promise<{ok: boolean, method: string, undo?: () => void}>}
 *   🔴 `undo`는 **되돌릴 수 있는 경로에서만** 실려 온다 (S24 / Spec 부가 1). Range 직접 조작
 *      경로(2-b)는 에디터의 undo 스택을 타지 않아 정확한 복원을 보장할 수 없으므로 **일부러
 *      주지 않는다** — 못 하는 일을 버튼으로 내밀지 않는다.
 */
export async function applyText({ target, range, text, mode = 'replace' }) {
  if (!text) return { ok: false, method: APPLY_METHOD.FAILED };

  // ── 1) 폼 필드 — 가장 안전하고 예측 가능한 경로.
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
    try {
      const current = String(target.value);
      // S24 / Spec 부가 1 — 되돌리기용 스냅샷. 값만 있으면 완전히 복원된다.
      const undo = () => setFormValue(target, current);
      const caretStart = target.selectionStart ?? 0;
      const caretEnd = target.selectionEnd ?? current.length;
      const hasSelection = caretEnd > caretStart;

      /**
       * 🔴 'append'는 기존 내용을 건드리지 않고 끝에 붙인다.
       * 🔴 'replace'인데 **선택이 없으면**(캐럿만) 내용 **전체**를 바꾼다 — 저장 문구를 "기존 내용
       *    지우고 넣기"로 고른 경우가 이 경로다. 캐럿 자리에 끼워 넣기만 하면 초안이 남아
       *    `…문구…초안입니다.`처럼 뒤섞인다(2026-08-13 실측).
       *    선택이 있으면 그 구간만 바꾼다(교정문 적용의 기존 동작 — 인용문 보존, Lessons #2).
       */
      const start = mode === 'append' ? current.length : hasSelection ? caretStart : 0;
      const end = mode === 'append' ? current.length : hasSelection ? caretEnd : current.length;
      const body = mode === 'append' && current.trim() !== '' ? ` ${text}` : text;
      target.focus();
      target.setRangeText(body, start, end, 'end');
      // React 등 프레임워크가 관리하는 입력창은 이 이벤트가 없으면 상태가 갱신되지 않는다.
      target.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, method: APPLY_METHOD.FORM_FIELD, undo };
    } catch {
      return fallbackToClipboard(text);
    }
  }

  // ── 2) contentEditable — 선택 구간만 교체한다(본문 전체 치환 금지, Lessons #2).
  const editable = target?.isContentEditable ? target : null;

  /**
   * 🔴 2-0) **선택 없이 커서만 있는 경우**(2026-08-13 실측): 저장 문구를 바로 넣는 경로에서는
   *    복제해 둔 Range가 없다. 예전엔 여기서 그대로 클립보드 폴백으로 빠져 "복붙하세요"가 떴는데,
   *    사용자는 바로 들어가길 기대한다. 캐럿 위치에 그대로 삽입한다.
   */
  if (editable && !range) {
    try {
      editable.focus();
      const selection = window.getSelection();
      const insideEditable =
        selection?.rangeCount > 0 && editable.contains(selection.getRangeAt(0).startContainer);
      /**
       * 🔴 **replace는 contentEditable에서도 전체를 바꿔야 한다**(2026-08-13 실측 결함):
       *    폼 필드에만 전체 치환을 넣어서, ChatGPT처럼 contentEditable을 쓰는 입력창에서는
       *    "기존 내용 지우고 넣기"를 골라도 초안이 그대로 남았다. 여기서도 내용을 통째로
       *    선택한 뒤 넣는다. 'append'는 끝으로 보내 기존 내용을 보존한다.
       */
      if (mode === 'replace') {
        const all = document.createRange();
        all.selectNodeContents(editable);
        selection?.removeAllRanges();
        selection?.addRange(all);
      } else if (!insideEditable || mode === 'append') {
        const end = document.createRange();
        end.selectNodeContents(editable);
        end.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(end);
      }
      const before = editable.textContent;
      // 이어 붙일 때 앞 글자와 달라붙지 않게 공백을 넣는다(폼 필드 경로와 같은 규칙).
      const body = mode === 'append' && before.trim() !== '' ? ` ${text}` : text;
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, body);
      } catch {
        inserted = false;
      }
      if (inserted && editable.textContent !== before) {
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: body }));
        return { ok: true, method: APPLY_METHOD.INSERT_TEXT, undo: () => undoContentEditable(editable, before) };
      }
    } catch {
      // 아래 폴백으로 흘려보낸다.
    }
    return fallbackToClipboard(text);
  }

  if (editable && range) {
    const restored = restoreSelection(editable, range);
    if (restored) {
      const before = editable.textContent;

      // 2-a) insertText — 에디터의 undo 스택과 서식 처리를 그대로 태운다.
      //      deprecated지만 리치 에디터 호환성에서 아직 대체재가 없다(구 T47 실측).
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch {
        inserted = false;
      }
      if (inserted && editable.textContent !== before) {
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        return { ok: true, method: APPLY_METHOD.INSERT_TEXT, undo: () => undoContentEditable(editable, before) };
      }

      // 2-b) Range 직접 조작 — insertText가 막힌 에디터용.
      try {
        const selection = window.getSelection();
        const active = selection?.rangeCount ? selection.getRangeAt(0) : range;
        active.deleteContents();
        active.insertNode(document.createTextNode(text));
        selection?.collapseToEnd();
        if (editable.textContent !== before) {
          editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
          return { ok: true, method: APPLY_METHOD.RANGE };
        }
      } catch {
        // 아래 클립보드 폴백으로 떨어진다.
      }
    }
  }

  // ── 3) 어느 경로도 못 쓰면 클립보드 (Spec 필수 5).
  return fallbackToClipboard(text);
}

/**
 * 팝업을 클릭하는 순간 페이지 선택이 사라지므로, 저장해 둔 Range를 되살린다.
 * 되살릴 수 없으면(에디터가 DOM을 갈아엎은 경우 등) false — 조용히 엉뚱한 곳에 쓰지 않는다.
 */
function restoreSelection(editable, range) {
  try {
    if (!editable.contains(range.commonAncestorContainer)) return false;
    editable.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

/** Spec 필수 5 — "클립보드에 자동 복사되었습니다 (Ctrl+V)". */
async function fallbackToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true, method: APPLY_METHOD.CLIPBOARD };
    }
  } catch {
    // 문서에 포커스가 없으면 Clipboard API가 거부한다 — 아래 legacy 경로로 간다.
  }

  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    // 화면에 보이지 않으면서도 선택 가능해야 한다 — display:none이면 복사가 안 된다.
    scratch.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(scratch);
    scratch.select();
    const copied = document.execCommand('copy');
    scratch.remove();
    if (copied) return { ok: true, method: APPLY_METHOD.CLIPBOARD };
  } catch {
    // 아래로.
  }

  return { ok: false, method: APPLY_METHOD.FAILED };
}

/**
 * 클립보드 복사만 단독으로 쓴다 (S37 회신 초안 「복사」 버튼).
 *
 * 🔴 새 구현을 만들지 않고 `applyText`가 폴백으로 쓰는 **같은 경로**를 그대로 노출한다.
 *    복사 코드가 두 벌이 되면 한쪽만 고치는 사고가 난다 — 특히 문서에 포커스가 없을 때
 *    Clipboard API가 거부하는 경우의 legacy 폴백은 잊기 쉽다.
 *
 * @returns {Promise<boolean>} 복사 성공 여부.
 */
export async function copyToClipboard(text) {
  if (typeof text !== 'string' || text === '') return false;
  const { ok } = await fallbackToClipboard(text);
  return ok;
}
