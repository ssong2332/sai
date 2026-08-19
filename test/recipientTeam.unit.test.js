/**
 * 수신자별 팀 선택 (2026-08-19 사용자 요청 ③).
 *
 * 🔴 여기서 잠그는 것은 **세 가지 상태가 서로 다르게 동작한다**는 사실이다.
 *    「개인」을 `null`로 저장하면 「아직 안 정함」과 구별되지 않아, 개인을 골라도 활성 팀
 *    용어가 계속 실린다 — 화면과 결과가 어긋나는 전형적인 자리다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PERSONAL_TEAM_ID } from '../src/lib/recipients.js';

test('🔴 「개인」 값은 팀 id와 겹칠 수 없는 모양이다', () => {
  assert.equal(typeof PERSONAL_TEAM_ID, 'string');
  assert.ok(PERSONAL_TEAM_ID.startsWith('__'), '서버가 만드는 id와 구분되지 않는다');
  assert.notEqual(PERSONAL_TEAM_ID, '');
});

/** 판정표를 코드로 옮긴 것 — `refineClient.js`의 구현이 이 표와 같아야 한다. */
function resolveTeam({ requestTeamId, recipientTeamId }) {
  return requestTeamId ?? recipientTeamId ?? null;
}

test('🔴 팀 판정표 — 팝업 > 수신자 기록 > 미지정(활성 팀)', () => {
  const rows = [
    [{ requestTeamId: 'T1', recipientTeamId: 'T2' }, 'T1'], // 팝업이 최우선
    [{ requestTeamId: null, recipientTeamId: 'T2' }, 'T2'], // 기억해 둔 값
    [{ requestTeamId: null, recipientTeamId: null }, null], // 미지정 → 활성 팀
    [{ requestTeamId: PERSONAL_TEAM_ID, recipientTeamId: 'T2' }, PERSONAL_TEAM_ID],
    [{ requestTeamId: null, recipientTeamId: PERSONAL_TEAM_ID }, PERSONAL_TEAM_ID],
  ];
  for (const [input, expected] of rows) {
    assert.equal(resolveTeam(input), expected, JSON.stringify(input));
  }
});

test('🔴 「개인」이면 팀 용어집을 아예 부르지 않는다 — 부르면 활성 팀으로 폴백해 버린다', () => {
  const source = readFileSync(new URL('../src/content/refineClient.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /teamId === PERSONAL_TEAM_ID \? \[\] : await listTeamGlossary/,
    'refineClient가 「개인」을 걸러내지 않는다',
  );
});

test('🔴 팝업이 선택을 그 사람 기록에 남긴다 — 전역 한 칸에 저장하면 상대가 바뀌어도 따라붙는다', () => {
  const source = readFileSync(new URL('../src/content/SaiOverlay.jsx', import.meta.url), 'utf8');
  assert.match(source, /const rememberTeam = async \(next\) => \{/, 'rememberTeam이 없다');
  assert.match(source, /updateRecipient\(recipient\.id, \{ teamId: next \}\)/, '수신자에 저장하지 않는다');
});

test('🔴 수신자 저장 계층이 teamId를 그대로 보존한다', async () => {
  const source = readFileSync(new URL('../src/lib/recipients.js', import.meta.url), 'utf8');
  // 빈 문자열은 null로, 나머지 문자열은 그대로 — 「개인」 값이 여기서 버려지면 안 된다.
  assert.match(source, /merged\.teamId =\s*\n?\s*typeof merged\.teamId === 'string'/);
});

/* ── 2026-08-19 자체 점검에서 잡은 회귀들을 잠근다 ─────────────────── */

test('🔴 addRecipient의 기본 teamId는 「개인」이다 — 입구(팝업·자동 감지·폼)가 아니라 저장 계층이 정한다', async () => {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {},
  };
  const { addRecipient } = await import('../src/lib/recipients.js');
  // 팝업의 「＋ 새 사람 추가」·자동 감지 추가는 teamId를 넘기지 않는다 — 그 경로가 이 모양이다.
  const created = await addRecipient({ name: '외부 파트너', timeZone: 'Asia/Tokyo' });
  assert.equal(created.teamId, PERSONAL_TEAM_ID, '새 사람이 활성 팀 용어를 받게 된다');
  // 명시한 값은 그대로.
  const explicit = await addRecipient({ name: '팀 동료', timeZone: 'Asia/Seoul', teamId: 'T1' });
  assert.equal(explicit.teamId, 'T1');
});

test('🔴 다크 배지 일반 규칙이 변형 배지(green·alert)를 제외한다 — 「전송 차단됨」이 주황이 되면 안 된다', () => {
  const css = readFileSync(new URL('../src/content/content.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.sai-badge:not\(\.sai-badge-green\):not\(\.sai-badge-alert\)/,
    '일반 다크 배지 규칙에 제외 조건이 없다 — 특이도·순서 싸움으로 변형 배지가 덮인다',
  );
  // 제외 없이 .sai-badge에 바로 색을 거는 다크 규칙이 되살아나면 안 된다.
  const bare = css.match(/data-theme='dark'\]\) \.sai-badge \{/g) ?? [];
  assert.equal(bare.length, 0, '제외 없는 다크 .sai-badge 규칙이 있다');
});
