/**
 * 결정 로그 로컬 저장소 단위 테스트 (S25 / Spec 부가 7).
 *
 * 이 스위트가 지키는 불변식:
 *   - 동의 없이는 저장되지 않는다 (기능 잠금의 실제 강제 지점)
 *   - 동의 철회는 저장분을 함께 지운다 (철회가 말뿐이 아니게)
 *   - 시각은 ISO 문자열이다 (`Date`는 chrome.storage를 통과하면 `{}`가 된다 — S26 실사고)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasConsent,
  setConsent,
  saveDecisionLog,
  listDecisionLogs,
  deleteDecisionLog,
  clearDecisionLogs,
  MAX_DECISION_LOGS,
  SAVE_REJECTIONS,
} from '../src/lib/decisions.js';
import { removeLocal, STORAGE_KEYS } from '../src/lib/storage.js';

const ROWS = [
  {
    decision: '롤아웃을 금요일에 배포한다',
    owner: 'Jin',
    dueDate: 'Friday',
    authorityStatus: '확정',
    authorityEvidence: '"Friday works"',
  },
  {
    decision: '가격 변경안을 적용한다',
    owner: 'Miguel',
    dueDate: null,
    authorityStatus: '내부 승인 필요',
    authorityEvidence: '"need sign-off"',
  },
];

/** 테스트끼리 상태가 새지 않게 매번 비운다(스토리지는 모듈 수준 메모리 폴백을 쓴다). */
async function reset() {
  await removeLocal(STORAGE_KEYS.DECISION_LOGS);
  await removeLocal(STORAGE_KEYS.DECISIONS_CONSENT);
}

/* ── 동의 게이트 ─────────────────────────────────────────────────────── */

test('동의는 기본값이 false다 — 켜진 채로 시작하지 않는다', async () => {
  await reset();
  assert.equal(await hasConsent(), false);
});

test('🔴 동의 없이 저장하면 거절한다 — 예외가 아니라 사유를 돌려준다', async () => {
  await reset();
  const result = await saveDecisionLog({ decisions: ROWS });

  assert.equal(result.ok, false);
  assert.equal(result.reason, SAVE_REJECTIONS.NO_CONSENT);
  assert.deepEqual(await listDecisionLogs(), []);
});

test('동의 후에는 저장된다', async () => {
  await reset();
  await setConsent(true);
  const result = await saveDecisionLog({ decisions: ROWS, sourceLabel: 'mail.google.com' });

  assert.equal(result.ok, true);
  assert.equal(result.entry.decisionCount, 2);
  assert.equal(result.entry.unresolvedCount, 1);
  assert.equal(result.entry.sourceLabel, 'mail.google.com');
  assert.equal((await listDecisionLogs()).length, 1);
});

test('🔴 동의를 철회하면 저장분이 함께 지워진다 — 철회가 말뿐이 아니어야 한다', async () => {
  await reset();
  await setConsent(true);
  await saveDecisionLog({ decisions: ROWS });
  await saveDecisionLog({ decisions: ROWS });
  assert.equal((await listDecisionLogs()).length, 2);

  const result = await setConsent(false);

  assert.equal(result.consent, false);
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(await listDecisionLogs(), []);
  assert.equal(await hasConsent(), false);
});

test('철회 후 다시 저장하려 하면 또 거절된다', async () => {
  await reset();
  await setConsent(true);
  await setConsent(false);

  const result = await saveDecisionLog({ decisions: ROWS });
  assert.equal(result.reason, SAVE_REJECTIONS.NO_CONSENT);
});

/* ── 저장 규칙 ───────────────────────────────────────────────────────── */

test('빈 요약은 저장하지 않는다 — "결정 없음"을 로그로 쌓을 이유가 없다', async () => {
  await reset();
  await setConsent(true);

  const result = await saveDecisionLog({ decisions: [] });
  assert.equal(result.reason, SAVE_REJECTIONS.EMPTY);
});

test('🔴 savedAt은 ISO 문자열이다 — Date 객체는 chrome.storage를 통과하면 {}가 된다', async () => {
  await reset();
  await setConsent(true);
  const { entry } = await saveDecisionLog({ decisions: ROWS });

  assert.equal(typeof entry.savedAt, 'string');
  assert.match(entry.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  // JSON 왕복(= storage 통과)에서도 살아남는지 — 이게 S26에서 깨졌던 지점이다.
  const roundTripped = JSON.parse(JSON.stringify(entry));
  assert.equal(roundTripped.savedAt, entry.savedAt);
});

test('상한을 넘으면 저장하지 않고 full로 알린다', async () => {
  await reset();
  await setConsent(true);
  for (let i = 0; i < MAX_DECISION_LOGS; i += 1) {
    await saveDecisionLog({ decisions: ROWS });
  }

  const result = await saveDecisionLog({ decisions: ROWS });
  assert.equal(result.reason, SAVE_REJECTIONS.FULL);
  assert.equal((await listDecisionLogs()).length, MAX_DECISION_LOGS);
});

test('최신 항목이 앞에 온다', async () => {
  await reset();
  await setConsent(true);
  await saveDecisionLog({ decisions: ROWS, title: '첫째' });
  await saveDecisionLog({ decisions: ROWS, title: '둘째' });

  const list = await listDecisionLogs();
  assert.equal(list[0].title, '둘째');
});

/* ── 삭제 (조건 ③) ──────────────────────────────────────────────────── */

test('개별 삭제가 된다', async () => {
  await reset();
  await setConsent(true);
  const { entry } = await saveDecisionLog({ decisions: ROWS });
  await saveDecisionLog({ decisions: ROWS });

  const result = await deleteDecisionLog(entry.id);
  assert.equal(result.deleted, true);
  const list = await listDecisionLogs();
  assert.equal(list.length, 1);
  assert.equal(list.find((row) => row.id === entry.id), undefined);
});

test('전체 삭제는 동의를 유지한 채 내용만 비운다', async () => {
  await reset();
  await setConsent(true);
  await saveDecisionLog({ decisions: ROWS });

  const result = await clearDecisionLogs();
  assert.equal(result.deletedCount, 1);
  assert.deepEqual(await listDecisionLogs(), []);
  // 🔴 동의는 살아 있어야 한다 — 비우기와 철회는 다른 행동이다.
  assert.equal(await hasConsent(), true);
});
