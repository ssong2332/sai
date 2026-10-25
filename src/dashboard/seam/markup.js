/**
 * Seam 화면의 뼈대 HTML — 확장 페이지(`src/dashboard/index.html`)와 웹 예시(`dashboard/index.html`)가 **같은 것**을 쓴다.
 *
 * 🔴 2026-10-25 (0.1.21) — 예전에는 `dashboard/index.html` 본문에 직접 있었다. 확장 페이지가 같은 화면을 그리면서
 *    두 벌이 되지 않게 여기로 옮겼다. 각 페이지의 `index.html`은 `<div id="seam">` 하나만 둔다.
 * 🔴 사용자 문자열이 없다 — 고정 문구뿐이다. 팀 이름 같은 값은 `app.js`가 `esc()`로 넣는다.
 * 🔴 인라인 스크립트가 없다 — 확장 페이지 CSP(`script-src 'self'`)가 막는다.
 */

/** 뼈대를 `root`에 넣는다. 확장 페이지는 화면 위에 「상태」 판(로그인·팀 없음·오류)을 쓴다. */
export function mountSeamMarkup(root = document.getElementById('seam')) {
  root.innerHTML = SEAM_MARKUP;
}

export const SEAM_MARKUP = `
<header class="bar">
  <div class="bar-in">
    <svg class="mark" width="34" height="17" viewBox="0 0 188 96" aria-hidden="true"><rect x="14" y="20" width="118" height="16" style="fill:var(--mark-bar)"/><rect x="56" y="44" width="118" height="16" style="fill:var(--mark-bar)"/><rect x="14" y="68" width="160" height="16" fill="#ec3013"/></svg>
    <span class="brand">사이 <span>Team Health</span></span>
    <span class="demo" id="demo" hidden>예시 데이터</span>
    <span class="sp"></span>
    <label class="sr" for="team">팀</label>
    <select id="team" class="team-pick"></select>
    <button id="theme" class="icon-btn" type="button" aria-label="화면 밝기 바꾸기">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
    </button>
  </div>
</header>

<p class="demo-note" id="demo-note" hidden><b>예시 데이터</b>예요 — 실제 팀이 아니에요. 실제 팀 지표는 사이 확장 안에서 봐요: 사이드패널 → 팀 → 「대시보드 열기」. 이 페이지는 주소로 팀 데이터를 받지 않아요.</p>

<section class="gate" id="gate" aria-labelledby="gate-h" aria-live="polite" hidden>
  <h1 id="gate-h"></h1>
  <p id="gate-p"></p>
  <div class="gate-acts" id="gate-acts"></div>
</section>

<div id="board">
<section class="loom" aria-labelledby="hl">
  <div class="loom-in">
    <div class="lede">
      <div>
        <div class="kick" id="kick">최근 30일</div>
        <h1 class="headline" id="hl"></h1>
      </div>
      <div class="index">
        <div class="index-n num" id="idx" aria-describedby="idx-l">—</div>
        <div class="index-l" id="idx-l">협업 건강도 · 100 − 마찰 비율</div>
        <div class="delta" id="delta" hidden></div>
      </div>
    </div>
    <div class="range" role="group" aria-label="기간" id="range">
      <span class="knob" id="knob" aria-hidden="true"></span>
    </div>
    <p class="range-note" id="range-note" aria-live="polite" hidden></p>
    <div class="weave-wrap">
      <svg class="weave" id="weave" role="img" aria-labelledby="weave-desc"><desc id="weave-desc"></desc></svg>
    </div>
    <div class="legend" aria-hidden="true">
      <span><i style="background:var(--thread-a)"></i><b id="lg-a"></b> 실</span>
      <span><i style="background:var(--thread-b)"></i><b id="lg-b"></b> 실</span>
      <span>두 실 사이가 벌어질수록 그날 다듬은 글 대비 마찰이 많았어요</span>
      <span>날짜에 올리면 그날의 마찰 신호 수가 나와요</span>
    </div>
    <div class="day" id="day" aria-live="polite"></div>
  </div>
</section>

<main class="page">
  <section class="empty" id="empty" aria-labelledby="empty-h" hidden>
    <h2 id="empty-h">아직 쌓인 신호가 없어요</h2>
    <p>이 기간에 이 팀에서 다듬은 메시지가 없어요. 팀원이 사이로 글을 다듬거나 받은 글의 뜻을 풀면, 그날의 합계가 여기에 날짜별로 쌓여요.</p>
    <p class="empty-n">기간을 늘려 보거나, 아래에서 다른 팀을 골라 보세요.</p>
  </section>

  <div id="filled">
    <section class="brief" aria-labelledby="brief-h">
      <div class="brief-k"><span id="brief-h">회의에 띄울 한 장</span><button type="button" class="copy" id="copy">글로 복사</button></div>
      <div id="brief"></div>
    </section>

    <section class="story" aria-label="이 기간의 이야기" id="story"></section>

    <section aria-labelledby="flow-h">
      <div class="sec-h"><div><h2 id="flow-h">주마다 본 흐름</h2><p>이 기간을 주(월~일)로 묶은 마찰 비율이에요. 7일을 다 채우지 못했거나 다듬은 글이 30건 안 되는 주는 흐리게 두고, 흐름을 말할 때 빼요. 점선은 흐름에 넣은 주로 그은 추세선이에요.</p></div></div>
      <p class="flow-say" id="flow-say" aria-live="polite"></p>
      <div class="flow-wrap"><svg class="flow" id="flow" role="img" aria-labelledby="flow-desc"></svg></div>
      <div class="key flow-key" aria-hidden="true"><span><i class="use"></i>흐름에 넣은 주</span><span><i class="thin"></i>글이 적은 주</span><span><i class="part"></i>7일이 안 되는 주(기간 처음·끝)</span><span><i class="tl"></i>추세선</span></div>
    </section>

    <section aria-labelledby="act-h">
      <div class="sec-h"><div><h2 id="act-h">다음에 할 일</h2><p>데이터가 가리키는 곳부터 순서대로 놓았어요. 각 항목 오른쪽은 그렇게 판단한 근거예요.</p></div></div>
      <ol class="acts" id="acts"></ol>
    </section>

    <section aria-labelledby="saved-h">
      <div class="sec-h"><div><h2 id="saved-h">사이가 막아 낸 것</h2><p>마찰이 될 뻔했다가 보내기 전에 정리된 것들이에요. 팀이 이미 잘하고 있는 부분이기도 해요.</p></div></div>
      <div class="saved" id="saved"></div>
    </section>

    <section class="pair" aria-label="상대 쪽 글과 긴급도">
      <div>
        <div class="sec-h"><div><h2 id="in-h">상대 쪽에서 온 글</h2><p>팀이 받은 글을 「뜻 풀기」로 연 횟수와, 그중 겉말과 실제 의도가 달랐던 비율이에요. 상대 쪽 글이 얼마나 읽기 어려운지 보여 줘요.</p></div></div>
        <div class="panel" id="inbound"></div>
      </div>
      <div>
        <div class="sec-h"><div><h2 id="tmp-h">긴급도의 온도</h2><p>다듬은 메시지마다 붙은 긴급도를 날짜별로 쌓았어요. 빨강이 두꺼운 날은 팀 전체가 쫓기던 날이에요.</p></div></div>
        <div class="panel" id="temp"></div>
      </div>
    </section>

    <section aria-labelledby="map-h">
      <div class="sec-h">
        <div>
          <h2 id="map-h">어떤 신호가, 언제</h2>
          <p>신호 여덟 가지를 날마다 한 칸씩 놓았어요. 칸이 짙을수록 그 신호가 그날 많았어요(신호마다 가장 많았던 날이 가장 짙어요). 날짜를 누르면 그날, 끌거나 Shift를 누른 채 누르면 사이의 날을 골라 오른쪽 합계로 봐요.</p>
        </div>
      </div>
      <div class="smap-top" id="smap-top"></div>
      <div class="smap-wrap" id="smap-wrap"><div class="smap" id="smap"></div><div class="smap-tip" id="smap-tip" hidden></div></div>
    </section>

    <section aria-labelledby="wd-h">
      <div class="sec-h">
        <div>
          <h2 id="wd-h">요일의 결</h2>
          <p>같은 기간을 요일로 접었어요. 회색은 다듬은 메시지, 노랑은 그중 마찰 신호예요. 테두리가 있는 요일이 마찰 비율이 가장 높아요.</p>
        </div>
      </div>
      <div class="rhythm" id="rhythm"></div>
    </section>
  </div>

  <section aria-labelledby="cmp-h">
    <div class="sec-h"><div><h2 id="cmp-h">맡은 관계 나란히</h2><p>내가 볼 수 있는 팀 관계를 같은 기간·같은 축으로 놓았어요. 누르면 위 화면이 그 관계로 바뀌어요.</p></div></div>
    <div class="cmp" id="cmp"></div>
    <p class="range-note cmp-note" id="cmp-note" hidden></p>
  </section>

  <footer class="foot">
    <span><b>●</b> 메시지 본문은 저장하지 않아요. 여기 보이는 수치는 모두 팀 단위 합계예요 — 누가 보냈는지는 나오지 않아요.</span>
    <span id="foot-src">사이 Team Health</span>
  </footer>
</main>
</div>
`;
