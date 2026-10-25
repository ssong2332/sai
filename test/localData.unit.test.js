/**
 * 「데이터 보기」 개수표 (`src/lib/localData.js`, 2026-10-25).
 *
 * 🔴 이 테스트가 지키는 것: 반환값에 **숫자와 불리언만** 있다 — 저장된 본문·용어·수신자 이름·토큰·이메일이
 *    어떤 형태로도 섞이지 않는다(Zero Retention, CLAUDE.md 금지 1).
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeLocalData, readLocalDataSummary } from '../src/lib/localData.js';
import { clearAllLocal, setLocal, STORAGE_KEYS } from '../src/lib/storage.js';

beforeEach(async () => {
  await clearAllLocal();
});

const SECRETS = ['비밀 본문 문장', 'Alice Kim', 'secret-token-xyz', 'me@example.com', 'uid-123', 'Team Rocket', '배포'];

async function seed() {
  await setLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, [
    { id: 'g1', sourceText: '배포', targetText: 'deploy' },
    { id: 'g2', sourceText: 'Sai', targetText: null, keepSource: true },
  ]);
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 4, 'deadline-explicit': 0, junk: 'x' });
  await setLocal(STORAGE_KEYS.LEARNED_DELETIONS, { all: false, kinds: ['x'] });
  await setLocal(STORAGE_KEYS.SNIPPETS, [{ id: 's1', text: '비밀 본문 문장' }]);
  await setLocal(STORAGE_KEYS.RESERVATIONS, [{ id: 'r1', text: '비밀 본문 문장', recipientName: 'Alice Kim' }, { id: 'r2' }]);
  await setLocal(STORAGE_KEYS.RECIPIENTS, [{ id: 'p1', name: 'Alice Kim', timeZone: 'America/New_York' }]);
  await setLocal(STORAGE_KEYS.DECISION_LOGS, [{ id: 'd1', decisions: ['비밀 본문 문장'] }]);
  await setLocal(STORAGE_KEYS.DECISIONS_CONSENT, true);
  await setLocal(STORAGE_KEYS.TEAMS, [{ teamId: 't1', name: 'Team Rocket' }]);
  await setLocal(STORAGE_KEYS.AUTH, { uid: 'uid-123', email: 'me@example.com', idToken: 'secret-token-xyz' });
  await setLocal(STORAGE_KEYS.GITHUB_TOKEN, { accessToken: 'secret-token-xyz' });
  await setLocal(STORAGE_KEYS.SITE_BLOCKLIST, ['example.com']);
  await setLocal(STORAGE_KEYS.SITE_INTEGRATIONS_OFF, ['slack', 'github']);
}

test('개수를 센다', async () => {
  await seed();
  assert.deepEqual(await readLocalDataSummary(), {
    glossary: 2,
    learned: 1,
    snippets: 1,
    reservations: 2,
    recipients: 1,
    decisionLogs: 1,
    teams: 1,
    blockedSites: 1,
    integrationsOff: 2,
    signedIn: true,
    githubLinked: true,
    decisionsConsent: true,
    pendingLearnedDeletions: true,
  });
});

test('🔴 반환값에는 숫자·불리언만 — 저장된 문자열이 하나도 없다', async () => {
  await seed();
  const summary = await readLocalDataSummary();
  for (const [key, value] of Object.entries(summary)) {
    assert.ok(typeof value === 'number' || typeof value === 'boolean', `${key}는 ${typeof value}`);
  }
  const text = JSON.stringify(summary);
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, `${secret}가 섞였다`);
});

test('비어 있거나 깨진 저장값은 0·false', () => {
  assert.deepEqual(summarizeLocalData({}), {
    glossary: 0,
    learned: 0,
    snippets: 0,
    reservations: 0,
    recipients: 0,
    decisionLogs: 0,
    teams: 0,
    blockedSites: 0,
    integrationsOff: 0,
    signedIn: false,
    githubLinked: false,
    decisionsConsent: false,
    pendingLearnedDeletions: false,
  });
  const broken = summarizeLocalData({ glossary: 'x', learned: [1, 2], auth: { email: 'only' }, decisionsConsent: 'true', learnedDeletions: { all: true } });
  assert.equal(broken.glossary, 0);
  assert.equal(broken.learned, 0);
  assert.equal(broken.signedIn, false, 'uid 없는 세션은 로그인으로 보지 않는다(getSession과 같다)');
  assert.equal(broken.decisionsConsent, false);
  assert.equal(broken.pendingLearnedDeletions, true);
});
