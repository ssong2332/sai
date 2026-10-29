/**
 * 사이트별 켜고 끄기 (`src/lib/siteGate.js`, 2026-10-25).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 호스트 정규화 — 스킴·경로·쿼리·포트·`www.`·`*.`를 떼고 소문자로. 형식 밖은 거절(저장 안 함).
 *    ② 맞춤 규칙 — 같은 호스트와 그 하위 도메인만(점 경계). `badslack.com`은 `slack.com`에 맞지 않는다.
 *    ③ 우선순위 — 「끔」이 언제나 이긴다: 차단 목록 > 꺼 둔 통합 > 켜짐. 통합 「켬」은 차단을 뒤집지 않는다.
 *    ⑤ 「끔」 = 자동 사이 버튼만 숨김. 단축키(Alt+D·Alt+X)는 산다(2026-10-25 사용자 결정).
 *    ④ 저장값을 믿지 않는다 — 형식 밖 항목·모르는 통합 id는 버린다.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  normalizeHost,
  hostMatches,
  evaluateSiteGate,
  integrationState,
  addToBlocklist,
  cleanBlocklist,
  cleanIntegrationsOff,
  findIntegration,
  INTEGRATIONS,
  MAX_BLOCKED_HOSTS,
  addBlockedHost,
  removeBlockedHost,
  setIntegrationEnabled,
  getSiteGateSettings,
  isPersonDetectHost,
} from '../src/lib/siteGate.js';
import { clearAllLocal, getLocal, STORAGE_KEYS } from '../src/lib/storage.js';

beforeEach(async () => {
  await clearAllLocal();
});

test('정규화 — 스킴·경로·쿼리·해시·포트·www·별표를 떼고 소문자로', () => {
  const cases = [
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['https://www.notion.so/My-Page-123?pvs=4#x', 'notion.so'],
    ['http://app.slack.com:8443/client/T1', 'app.slack.com'],
    ['*.atlassian.net', 'atlassian.net'],
    ['mail.google.com/mail/u/0/#inbox', 'mail.google.com'],
    ['user:pw@github.com/org', 'github.com'],
    ['example.com.', 'example.com'],
    ['localhost', 'localhost'],
    ['192.168.0.10', '192.168.0.10'],
  ];
  for (const [input, host] of cases) {
    assert.deepEqual(normalizeHost(input), { ok: true, host }, input);
  }
  // 국제화 도메인 — `URL`이 퓨니코드로 바꾼다(정규형이라 다시 넣어도 같다).
  const idn = normalizeHost('예시.한국');
  assert.equal(idn.ok, true);
  assert.match(idn.host, /^xn--[a-z0-9-]+\.xn--3e0b707e$/);
  assert.deepEqual(normalizeHost(idn.host), idn);
});

test('정규화 — 형식 밖은 거절한다', () => {
  for (const input of ['', '   ', null, 42, 'example', 'exa mple.com', 'a*.com', 'foo.*.com', '-bad.com', 'bad-.com', '[::1]', 'http://', '..']) {
    const result = normalizeHost(input);
    assert.equal(result.ok, false, String(input));
  }
  assert.equal(normalizeHost('').reason, 'empty');
  assert.equal(normalizeHost('nope').reason, 'invalid');
});

test('맞춤 — 같은 호스트와 점 경계의 하위 도메인만', () => {
  assert.equal(hostMatches('slack.com', 'slack.com'), true);
  assert.equal(hostMatches('app.slack.com', 'slack.com'), true);
  assert.equal(hostMatches('a.b.slack.com', 'slack.com'), true);
  assert.equal(hostMatches('www.slack.com', 'slack.com'), true);
  assert.equal(hostMatches('APP.Slack.com', 'slack.com'), true);
  assert.equal(hostMatches('badslack.com', 'slack.com'), false);
  assert.equal(hostMatches('slack.com.evil.io', 'slack.com'), false);
  assert.equal(hostMatches('slack.com', 'app.slack.com'), false, '상위 도메인은 하위 규칙에 맞지 않는다');
  assert.equal(hostMatches('', 'slack.com'), false);
});

test('🔴 판정 — 아무것도 없으면 켜짐(기존 동작)', () => {
  assert.equal(evaluateSiteGate('app.slack.com', {}).enabled, true);
  assert.equal(evaluateSiteGate('', { blocked: ['slack.com'] }).enabled, true, '호스트가 없으면 판정하지 않는다');
  assert.equal(evaluateSiteGate('app.slack.com', {}).integrationId, 'slack');
});

test('🔴 판정 — 차단 목록에 있으면 꺼짐(하위 도메인 포함)', () => {
  const gate = evaluateSiteGate('docs.example.com', { blocked: ['example.com'] });
  assert.deepEqual(gate, { enabled: false, reason: 'blocked', rule: 'example.com', integrationId: null });
});

test('🔴 판정 — 꺼 둔 통합의 사이트는 꺼짐', () => {
  const gate = evaluateSiteGate('mycorp.atlassian.net', { integrationsOff: ['atlassian'] });
  assert.equal(gate.enabled, false);
  assert.equal(gate.reason, 'integration-off');
  assert.equal(gate.integrationId, 'atlassian');
  assert.equal(evaluateSiteGate('github.com', { integrationsOff: ['atlassian'] }).enabled, true, '다른 사이트는 그대로');
});

test('🔴 우선순위 — 통합이 켜져 있어도 차단 목록이 이긴다', () => {
  // 통합 「켬」 = integrationsOff에 없음. 그래도 차단 목록에 있으면 꺼진다.
  const gate = evaluateSiteGate('app.slack.com', { blocked: ['slack.com'], integrationsOff: [] });
  assert.equal(gate.enabled, false);
  assert.equal(gate.reason, 'blocked');
  assert.equal(gate.integrationId, 'slack');
  // 둘 다 끔이면 reason은 blocked(차단 목록을 빼야 다시 켜진다고 말할 수 있게).
  assert.equal(evaluateSiteGate('app.slack.com', { blocked: ['slack.com'], integrationsOff: ['slack'] }).reason, 'blocked');
  // 차단 목록에서 빼면 통합 토글이 결정한다.
  assert.equal(evaluateSiteGate('app.slack.com', { blocked: [], integrationsOff: ['slack'] }).reason, 'integration-off');
  assert.equal(evaluateSiteGate('app.slack.com', { blocked: [], integrationsOff: [] }).enabled, true);
});

test('🔴 통합 화면 상태 — 토글이 켜져 있어도 차단 목록 때문에 꺼진 것을 알려 준다', () => {
  const slack = INTEGRATIONS.find((item) => item.id === 'slack');
  assert.deepEqual(integrationState(slack, { blocked: ['slack.com'] }), { on: true, blockedBy: 'slack.com' });
  assert.deepEqual(integrationState(slack, { blocked: ['app.slack.com'] }), { on: true, blockedBy: null }, '하위 호스트 차단은 사이트 전체가 아니다');
  assert.deepEqual(integrationState(slack, { integrationsOff: ['slack'] }), { on: false, blockedBy: null });
  const outlook = INTEGRATIONS.find((item) => item.id === 'outlook');
  assert.equal(integrationState(outlook, { blocked: ['office.com'] }).blockedBy, 'office.com', '상위 도메인 차단도 잡는다');
});

test('저장값을 믿지 않는다 — 형식 밖·중복·모르는 id는 버린다', () => {
  assert.deepEqual(cleanBlocklist(['Example.com', 'example.com', 'bad', 7, null, 'https://x.io/a']), ['example.com', 'x.io']);
  assert.deepEqual(cleanBlocklist('example.com'), []);
  assert.deepEqual(cleanIntegrationsOff(['slack', 'nope', 'github', 'slack']), ['slack', 'github']);
  assert.deepEqual(cleanIntegrationsOff({ slack: false }), []);
  assert.equal(evaluateSiteGate('bad', { blocked: ['bad'] }).enabled, true, '깨진 저장값으로 끄지 않는다');
});

test('목록 추가 — 정규화·중복·상한', () => {
  const first = addToBlocklist([], 'https://Example.com/path');
  assert.deepEqual(first, { ok: true, duplicate: false, host: 'example.com', list: ['example.com'] });
  const dup = addToBlocklist(first.list, 'www.example.com');
  assert.equal(dup.duplicate, true);
  assert.deepEqual(dup.list, ['example.com']);
  assert.equal(addToBlocklist([], 'nope').ok, false);
  const full = Array.from({ length: MAX_BLOCKED_HOSTS }, (_, i) => `s${i}.example.com`);
  assert.equal(addToBlocklist(full, 'new.io').reason, 'full');
});

test('통합 목록 — id·호스트가 겹치지 않고, 열기 링크는 https다', () => {
  const ids = INTEGRATIONS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  const hosts = INTEGRATIONS.flatMap((item) => item.hosts);
  assert.equal(new Set(hosts).size, hosts.length);
  for (const item of INTEGRATIONS) {
    assert.ok(item.openUrl.startsWith('https://'), item.id);
    assert.ok(item.description.length > 0 && item.description.length <= 60, `${item.id} 설명은 한 줄`);
    for (const host of item.hosts) assert.deepEqual(normalizeHost(host), { ok: true, host }, `${item.id} 호스트는 정규형`);
    // 🔴 Jira·Confluence는 회사마다 주소(`<회사>.atlassian.net`)가 달라 공용 시작 페이지로 연다 — 그 하나만 예외.
    if (item.id !== 'atlassian') {
      assert.equal(findIntegration(new URL(item.openUrl).hostname)?.id, item.id, `${item.id} 열기 링크가 자기 호스트에 맞는다`);
    }
  }
});

test('저장소 — 추가·빼기·통합 토글이 정해진 키에 정해진 모양으로만 남는다', async () => {
  await addBlockedHost('https://www.Example.com/x?q=secret');
  await addBlockedHost('foo.io');
  assert.deepEqual(await getLocal(STORAGE_KEYS.SITE_BLOCKLIST), ['example.com', 'foo.io'], '경로·쿼리는 저장하지 않는다');
  await removeBlockedHost('example.com');
  assert.deepEqual(await getLocal(STORAGE_KEYS.SITE_BLOCKLIST), ['foo.io']);

  await setIntegrationEnabled('slack', false);
  await setIntegrationEnabled('github', false);
  await setIntegrationEnabled('slack', true);
  assert.deepEqual(await getLocal(STORAGE_KEYS.SITE_INTEGRATIONS_OFF), ['github']);
  await assert.rejects(() => setIntegrationEnabled('nope', false));
  assert.deepEqual(await getSiteGateSettings(), { blocked: ['foo.io'], integrationsOff: ['github'] });
});

test('🔴 꺼진 사이트 — 오버레이는 늘 마운트하고 자동 버튼만 숨긴다(단축키는 산다)', () => {
  const boot = readFileSync(new URL('../src/content/index.jsx', import.meta.url), 'utf8');
  assert.match(boot, /<SiteGate>\{\(\{ autoButton \}\) => <SaiOverlay autoButton=\{autoButton\} \/>\}<\/SiteGate>/);
  const gate = readFileSync(new URL('../src/content/SiteGate.jsx', import.meta.url), 'utf8');
  assert.ok(gate.includes('evaluateSiteGate'), '판정을 lib 한 곳에서 한다');
  assert.ok(gate.includes('chrome.storage.onChanged'), '설정을 바꾸면 새로고침 없이 따라간다');
  assert.ok(gate.includes('return children({ autoButton: enabled === true })'), '관문이 오버레이를 통째로 빼지 않는다');
  assert.equal(/return enabled \? children : null/.test(gate), false, '예전 동작(오버레이 전체 제거)이 남아 있다');

  const overlay = readFileSync(new URL('../src/content/SaiOverlay.jsx', import.meta.url), 'utf8');
  assert.ok(overlay.includes('export default function SaiOverlay({ autoButton = true })'));
  // 자동 버튼 묶음은 autoButton이면서 글을 선택했을 때(2026-10-29 — 커서만으로는 안 뜬다) 또는
  // 사용자가 부른 것(Alt+X 저장 문구 · Alt+D 안내)일 때만 그린다.
  assert.ok(overlay.includes('const showFab = (autoButton && hasSelection) || snippetOpen || Boolean(fabHint);'));
  assert.ok(overlay.includes('{!open && showFab && ('));
  // 단축키 수신부는 autoButton을 보지 않는다 — 꺼진 사이트에서도 팝업을 연다.
  const onMessage = overlay.slice(overlay.indexOf("message?.type === 'refine-selection'"), overlay.indexOf('chrome.runtime.onMessage.addListener(onMessage)'));
  assert.ok(onMessage.length > 0, '단축키 수신부를 찾지 못했다');
  assert.equal(onMessage.includes('autoButton'), false, '단축키가 버튼 숨김 설정에 묶였다');
  // 열린 팝업(`open`)도 autoButton과 무관하다.
  assert.ok(overlay.includes('{open && ('));
});

/* ── 대화 상대 자동 감지 — 대화형 통합 8곳만 (2026-10-28) ──────────────── */

test('대화형 통합 8곳(하위 도메인 포함)에서는 감지한다', () => {
  for (const host of ['app.slack.com', 'mail.google.com', 'outlook.office.com', 'teams.microsoft.com', 'chat.google.com', 'www.linkedin.com', 'discord.com', 'web.whatsapp.com']) {
    assert.equal(isPersonDetectHost(host), true, host);
  }
});

test('🔴 문서형 통합(Notion·Jira·GitHub)에서는 감지하지 않는다 — 「배경:」·「이유:」 라벨이 이름으로 잡힌다', () => {
  for (const host of ['www.notion.so', 'acme.atlassian.net', 'github.com']) {
    assert.equal(isPersonDetectHost(host), false, host);
  }
});

test('🔴 통합 밖(AI 채팅·그 밖)에서는 감지하지 않는다 — Gemini 실측', () => {
  for (const host of ['gemini.google.com', 'chatgpt.com', 'claude.ai', 'news.naver.com', 'example.com', '', undefined]) {
    assert.equal(isPersonDetectHost(host), false, String(host));
  }
});

test('🔴 통합 토글을 꺼도 감지 대상 판정은 바뀌지 않는다 — 단축키로 연 팝업도 같은 판정', () => {
  assert.equal(findIntegration('app.slack.com')?.id, 'slack');
  assert.equal(isPersonDetectHost('app.slack.com'), true);
});
