/**
 * 탭 id 계약 (2026-08-16 사용자 지적 ⑥).
 *
 * 🔴 **왜 소스를 읽는 테스트인가.** 사이드패널은 `activeTab !== '<id>'`로 데이터 로딩을 건다.
 *    탭 이름이 개편되면서 `TABS`의 id는 바뀌었는데 그 가드는 옛 이름(`snippets`·`schedule`)에
 *    남아 있었고, 조건이 **한 번도 참이 되지 않아** 저장 문구·예약이 영영 로드되지 않았다.
 *    - 오류가 나지 않는다(그냥 return이다).
 *    - 빌드도 통과한다.
 *    - `no-undef`도 못 잡는다 — **식별자가 아니라 문자열**이다.
 *    잡을 수 있는 관문이 하나도 없어서, 여기서 소스를 직접 대조한다.
 * 🔴 이 테스트는 렌더링을 검증하지 않는다. **id가 실재하는가**만 본다 — 그 하나가 결함의 원인이었다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RAW = readFileSync(new URL('../src/sidepanel/App.jsx', import.meta.url), 'utf8');

/**
 * 🔴 **주석을 걷어내고 본다.** 이 파일의 주석에는 결함을 설명하려고 옛 id(`'snippets'`)가
 *    그대로 인용돼 있다 — 걷어내지 않으면 **설명이 테스트를 깨뜨린다.** 첫 실행에서 실제로 그랬다.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

/** `const TABS = [...]`에서 id만 뽑는다. */
function declaredTabIds() {
  const block = SOURCE.match(/const TABS = \[([\s\S]*?)\];/);
  assert.ok(block, 'TABS 선언을 찾지 못했다 — 테스트가 낡았다');
  return [...block[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
}

test('TABS에 id가 실제로 있다', () => {
  const ids = declaredTabIds();
  assert.ok(ids.length >= 2, `탭 id를 못 읽었다: ${JSON.stringify(ids)}`);
});

test('🔴 activeTab 비교에 쓰인 id가 전부 TABS에 있다', () => {
  const ids = new Set(declaredTabIds());
  const used = [...SOURCE.matchAll(/activeTab\s*(?:!==|===)\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'activeTab 비교를 하나도 못 찾았다 — 테스트가 낡았다');
  for (const id of used) {
    assert.ok(
      ids.has(id),
      `activeTab을 '${id}'와 비교하는데 TABS에 그런 탭이 없다 — 그 조건은 영영 참이 되지 않는다`,
    );
  }
});
