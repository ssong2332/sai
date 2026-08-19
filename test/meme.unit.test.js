/**
 * S16 — Work-Safe Filter 단위 테스트 (Spec 필수 8 · audit 4).
 *
 * 🔴 이 테스트가 지키려는 핵심:
 *    ① **거부 우선** — 금지 패턴에 안 걸려도 검수(`reviewed`)가 없으면 통과 못 한다.
 *    ② 동봉한 시드가 **전부** 필터를 통과한다(우리가 만든 데이터라고 예외를 두지 않는다).
 *    ③ 국가 단위 단정이 밈 해설로 스며드는 경로를 막는다.
 *    ④ 캐주얼 톤이 꺼져 있으면 표현이 **하나도** 나가지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkWorkSafe,
  filterWorkSafe,
  BLOCK_REASONS,
  MEME_SEED,
  seedForLanguage,
  buildCasualToneBlock,
  memeGlossary,
  findMemeSpans,
} from '../src/core/meme/index.js';

/* ── 거부 우선 ────────────────────────────────────────────────────────── */

test('🔴 검수 표시가 없으면 깨끗한 표현이어도 통과하지 못한다 (deny-by-default)', () => {
  const result = checkWorkSafe({ text: 'heads-up', meaning: '미리 알리는 공지' });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.UNREVIEWED));
});

test('검수 표시가 있고 금지 패턴에 안 걸리면 통과한다', () => {
  const result = checkWorkSafe({ text: 'heads-up', meaning: '미리 알리는 공지', reviewed: true });
  assert.equal(result.safe, true);
  assert.deepEqual(result.reasons, []);
});

/* ── 금지 패턴 (검수 표시가 있어도 막혀야 한다) ───────────────────────── */

test('🔴 검수 표시가 있어도 비속어는 막힌다 — 검수자가 놓친 것을 잡는 2차 그물', () => {
  const result = checkWorkSafe({ text: 'this shit is broken', reviewed: true });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.PROFANITY));
});

test('혐오·차별 표현은 막힌다', () => {
  const result = checkWorkSafe({ text: "that's retarded", reviewed: true });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.HATE));
});

test('한국어 혐오 표현도 막힌다', () => {
  const result = checkWorkSafe({ text: '틀딱 같은 소리', reviewed: true });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.HATE));
});

test('성적 표현은 막힌다', () => {
  const result = checkWorkSafe({ text: 'nsfw joke', reviewed: true });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.SEXUAL));
});

test('폭력·자해 표현은 막힌다', () => {
  const result = checkWorkSafe({ text: 'kys', reviewed: true });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.VIOLENCE));
});

test('정치·종교 논쟁 소재는 막힌다 — 업무 메시지에서 편을 가르면 관계가 상한다', () => {
  const result = checkWorkSafe({ text: 'like Trump would say', reviewed: true });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.CONTROVERSIAL));
});

test('🔴 국가 단위 단정이 해설에 섞이면 막힌다 (필수 2 3순위 · 필수 9)', () => {
  const result = checkWorkSafe({
    text: 'straight to the point',
    meaning: 'Germans are always direct, so use this.',
    reviewed: true,
  });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.NATIONAL_GENERALIZATION));
});

test('🔴 한국어 국가 단위 단정도 막힌다', () => {
  const result = checkWorkSafe({
    text: '수고하셨습니다',
    meaning: '한국인은 보통 이런 인사를 좋아한다',
    reviewed: true,
  });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.includes(BLOCK_REASONS.NATIONAL_GENERALIZATION));
});

test('🔴 차단 사유에 걸린 표현 원문이 담기지 않는다 — 비속어를 로그로 옮겨 나르지 않는다', () => {
  const result = checkWorkSafe({ text: 'this shit is broken', reviewed: true });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('shit'), `사유에 원문이 담기면 안 된다: ${serialized}`);
});

/* ── 시드 데이터 자체 검증 ───────────────────────────────────────────── */

test('🔴 동봉한 시드가 전부 필터를 통과한다 — 우리 데이터라고 예외를 두지 않는다', () => {
  for (const entry of MEME_SEED) {
    const result = checkWorkSafe(entry);
    assert.equal(result.safe, true, `시드 ${entry.id}가 막혔다: ${result.reasons.join(',')}`);
  }
});

test('시드는 전부 검수 표시(reviewed)를 갖는다', () => {
  for (const entry of MEME_SEED) {
    assert.equal(entry.reviewed, true, `시드 ${entry.id}에 reviewed가 없다`);
  }
});

test('🔴 시드는 국가 코드를 갖지 않는다 — 밈은 언어에 붙지 국적에 붙지 않는다', () => {
  for (const entry of MEME_SEED) {
    assert.equal(entry.countryCode, undefined, `시드 ${entry.id}에 국가 코드가 있으면 안 된다`);
    assert.equal(typeof entry.language, 'string');
  }
});

test('filterWorkSafe는 검수 안 된 항목을 걸러낸다', () => {
  const mixed = [
    { id: 'a', text: 'heads-up', reviewed: true },
    { id: 'b', text: 'circle back' }, // 검수 없음
    { id: 'c', text: 'this shit', reviewed: true }, // 비속어
  ];
  const safe = filterWorkSafe(mixed);
  assert.deepEqual(safe.map((entry) => entry.id), ['a']);
});

/* ── 캐주얼 톤 블록 ──────────────────────────────────────────────────── */

test('🔴 캐주얼 톤이 꺼져 있으면 표현이 하나도 나가지 않는다 (밈 자동 삽입 금지)', () => {
  assert.equal(buildCasualToneBlock('en', false), null);
});

test('캐주얼 톤을 켜면 해당 언어의 검수 표현이 실린다', () => {
  const block = buildCasualToneBlock('en', true);
  assert.ok(block !== null);
  assert.ok(block.expressions.length > 0);
  for (const expression of block.expressions) {
    assert.equal(typeof expression.text, 'string');
    assert.equal(typeof expression.meaning, 'string');
  }
});

/**
 * 🔴 **2026-08-16 계약 수정.** 예전에는 `fr`로 확인했는데, 이 테스트가 지키려던 것은
 *    「프랑스어는 지원하지 않는다」가 아니라 **「시드가 없는 언어에 표현을 지어내지 않는다」**였다.
 *    그런데 `fr`은 실제로 **지원 언어**였고(수신자가 고를 수 있다), 시드만 비어 있었다 —
 *    즉 이 테스트는 결함을 계약으로 굳혀 두고 있었다. 실제로 캐주얼 토글이 fr·de·es·ja에서
 *    **아무 일도 하지 않았고**, 그 사실을 아무도 몰랐다(사용자가 독일어에서 발견).
 *    이제 시드를 채웠으므로, 확인 대상을 **지원하지 않는 언어**로 바꾼다.
 *    지원 언어가 전부 채워져 있다는 계약은 `backcheck.unit.test.js`가 따로 지킨다.
 */
test('시드가 없는 언어는 켜도 null이다 — 없는 표현을 지어내지 않는다', () => {
  assert.equal(buildCasualToneBlock('pt', true), null);
  assert.equal(buildCasualToneBlock('it', true), null);
});

test('seedForLanguage는 해당 언어만 돌려준다', () => {
  for (const entry of seedForLanguage('zh')) {
    assert.equal(entry.language, 'zh');
  }
});

/* ── 밈 해설 (S19 / Spec 권장 4 후반부) ──────────────────────────────────
 *
 * 🔴 여기서 지키려는 것:
 *    ① 캐주얼 톤을 **꺼도** 직역 불가 표현은 해설된다(꺼짐=아무것도 안 함이 아니다).
 *    ② 검수(`reviewed`)를 통과하지 못한 표현은 해설 목록에도 **안 들어간다** — 프롬프트 경로와
 *       표시 경로가 같은 게이트를 쓴다.
 *    ③ 낱말 안에 박힌 우연한 일치를 해설하지 않는다.
 *    ④ 구간이 겹쳐 나오지 않는다(겹치면 마크업이 깨진다).
 */

test('🔴 캐주얼 톤이 꺼져 있어도 직역 불가 표현은 해설 대상이다', () => {
  const off = memeGlossary(false);
  assert.ok(off.length > 0, '꺼짐이 곧 빈 목록이면 모르는 표현을 그대로 보내게 된다');
  assert.ok(off.some((entry) => entry.text === 'circle back'));
});

test('캐주얼 톤을 켜면 대상이 넓어진다 (끈 목록의 상위집합)', () => {
  const off = memeGlossary(false);
  const on = memeGlossary(true);
  assert.ok(on.length > off.length, `on=${on.length} off=${off.length}`);
  for (const entry of off) {
    assert.ok(on.some((candidate) => candidate.id === entry.id), `${entry.id}가 on에서 빠졌다`);
  }
});

test('🔴 검수를 통과하지 못한 표현은 해설 목록에도 들어가지 않는다', () => {
  // 시드 전체가 이미 검수 통과이므로, 게이트가 살아 있는지는 시드가 전부 reviewed인지로 본다.
  for (const entry of memeGlossary(true)) {
    const seed = MEME_SEED.find((candidate) => candidate.id === entry.id);
    assert.equal(seed.reviewed, true, `${entry.id}가 검수 없이 해설 목록에 들어왔다`);
  }
});

test('시드의 explainAlways는 전부 boolean이다 — 빠뜨리면 조용히 안 뜬다', () => {
  for (const entry of MEME_SEED) {
    assert.equal(typeof entry.explainAlways, 'boolean', `시드 ${entry.id}에 explainAlways가 없다`);
  }
});

test('findMemeSpans는 대소문자를 무시하되 화면에는 원문 그대로를 남긴다', () => {
  const spans = findMemeSpans('Circle back next week.', memeGlossary(false));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].body, 'Circle back');
  assert.equal('Circle back next week.'.slice(spans[0].start, spans[0].end), 'Circle back');
});

test('🔴 낱말 안에 박힌 우연한 일치는 잡지 않는다', () => {
  const entries = [{ id: 'x', text: 'ship it', meaning: '뜻' }];
  assert.deepEqual(findMemeSpans('relationship items', entries), []);
  assert.equal(findMemeSpans('Just ship it.', entries).length, 1);
});

test('한자 표현은 낱말 경계를 요구하지 않는다 (경계 개념이 없다)', () => {
  const entries = [{ id: 'z', text: '收到', meaning: '확인했습니다' }];
  assert.equal(findMemeSpans('我收到了，谢谢。', entries).length, 1);
});

test('🔴 구간이 겹쳐 나오지 않는다', () => {
  const entries = [
    { id: 'a', text: 'sanity check', meaning: 'A' },
    { id: 'b', text: 'quick sanity check', meaning: 'B' },
  ];
  const spans = findMemeSpans('A quick sanity check please.', entries);
  for (let i = 1; i < spans.length; i += 1) {
    assert.ok(spans[i].start >= spans[i - 1].end, '구간이 겹쳤다');
  }
  // 같은 자리에서 부딪히면 긴 쪽(더 구체적인 표현)이 남는다.
  assert.equal(spans[0].body, 'quick sanity check');
});

test('빈 입력·빈 목록에서 죽지 않는다', () => {
  assert.deepEqual(findMemeSpans('', memeGlossary(true)), []);
  assert.deepEqual(findMemeSpans(null, memeGlossary(true)), []);
  assert.deepEqual(findMemeSpans('circle back', []), []);
});
