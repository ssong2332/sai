/**
 * 직전 대화 참고의 기본값 (2026-09-30 — 기본 꺼짐).
 *
 * 🔴 이 테스트가 지키는 것: ① 기본값이 **꺼짐**이다 — 상대가 쓴 메시지를 본인이 켜지 않았는데
 *    AI 제공자로 보내지 않는다 ② 읽는 곳이 전부 **같은 상수**를 쓴다 — 한 곳만 `true`로 남으면
 *    화면은 꺼짐인데 요청에는 실린다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THREAD_CONTEXT_DEFAULT } from '../src/lib/storage.js';

const READERS = ['../src/content/refineClient.js', '../src/content/SaiOverlay.jsx', '../src/sidepanel/App.jsx'];

test('🔴 직전 대화 참고는 기본 꺼짐이다', () => {
  assert.equal(THREAD_CONTEXT_DEFAULT, false);
});

test('🔴 읽는 곳이 전부 THREAD_CONTEXT_DEFAULT를 쓴다 — 리터럴 기본값이 없다', () => {
  for (const path of READERS) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.equal(/THREAD_CONTEXT,\s*(true|false)\)/.test(source), false, `${path}에 리터럴 기본값이 있다`);
    assert.ok(source.includes('THREAD_CONTEXT_DEFAULT'), `${path}가 공용 기본값을 쓰지 않는다`);
  }
});

test('🔴 오버레이는 지워진 키를 켜짐으로 읽지 않는다', () => {
  const overlay = readFileSync(new URL('../src/content/SaiOverlay.jsx', import.meta.url), 'utf8');
  assert.equal(overlay.includes('.newValue !== false'), false);
});
