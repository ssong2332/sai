import { useEffect, useState } from 'react';
import { Link } from '../router.jsx';

/**
 * 결제창 — Paddle 「기본 결제 링크」(2026-10-31, `docs/BillingDesign.md` ②).
 *
 * 확장이 Worker `/v1/billing/checkout`으로 거래를 만들면 Paddle이 `이 페이지?_ptxn=txn_…` 주소를 준다.
 * Paddle.js를 초기화하면 그 거래의 결제창을 스스로 연다 — 여기서 결제 정보를 다루지 않는다.
 *
 * 🔴 클라이언트 토큰은 **공개용**이다(Paddle 문서 — 프런트에 넣는 값). API 키는 Worker 시크릿에만 있다.
 * 🔴 토큰 앞머리로 환경을 고른다: `test_` = 샌드박스, `live_` = 실판매. 실판매 토큰으로 바꾸는 것은 사용자 승인 건.
 *
 * | 상태 | 조건 | 화면 |
 * |---|---|---|
 * | `missing` | 주소에 `_ptxn`이 없다 | 확장에서 업그레이드를 눌러 달라 |
 * | `loading` | Paddle.js를 불러오는 중 | 결제창을 여는 중 |
 * | `open` | 결제창이 열렸다 | 안내만 |
 * | `done` | `checkout.completed` | 끝났다 — 확장으로 돌아가 다듬으면 적용 |
 * | `closed` | 끝나기 전에 닫음 | 다시 열기 안내 |
 * | `error` | 스크립트 실패·`checkout.error` | 다시 시도 안내 |
 */
const PADDLE_CLIENT_TOKEN = 'test_68fd21f5f858995054bbf83e53c';
const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js';

function loadPaddle() {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PADDLE_JS;
    script.async = true;
    script.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error('no-paddle')));
    script.onerror = () => reject(new Error('load-failed'));
    document.head.appendChild(script);
  });
}

const COPY = {
  missing: { title: '결제를 시작할 거래가 없어요', body: '사이 확장의 설정에서 「Pro로 업그레이드」를 눌러 주세요. 이 페이지가 결제창과 함께 열려요.' },
  loading: { title: '결제창을 여는 중이에요', body: '잠시만 기다려 주세요.' },
  open: { title: '결제창이 열렸어요', body: '결제는 Paddle이 판매자로서 처리해요. 카드 정보는 사이가 받지 않아요.' },
  done: { title: '결제가 끝났어요', body: '확장으로 돌아가 다시 다듬으면 Pro 한도가 적용돼요. 영수증은 결제에 쓴 메일로 와요.' },
  closed: { title: '결제창을 닫았어요', body: '다시 열려면 확장에서 업그레이드를 한 번 더 눌러 주세요.' },
  error: { title: '결제창을 열지 못했어요', body: '잠시 뒤 확장에서 다시 시도해 주세요. 계속되면 아래 문의처로 알려 주세요.' },
};

export default function Checkout({ search }) {
  const hasTransaction = new URLSearchParams(search ?? '').has('_ptxn');
  const [state, setState] = useState(hasTransaction ? 'loading' : 'missing');

  useEffect(() => {
    document.title = '결제 — 사이';
    if (!hasTransaction) return undefined;
    let alive = true;
    loadPaddle()
      .then((Paddle) => {
        if (!alive) return;
        if (PADDLE_CLIENT_TOKEN.startsWith('test_')) Paddle.Environment.set('sandbox');
        Paddle.Initialize({
          token: PADDLE_CLIENT_TOKEN,
          eventCallback: (event) => {
            if (!alive) return;
            if (event?.name === 'checkout.loaded') setState('open');
            else if (event?.name === 'checkout.completed') setState('done');
            else if (event?.name === 'checkout.closed') setState((s) => (s === 'done' ? s : 'closed'));
            else if (event?.name === 'checkout.error') setState('error');
          },
        });
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
      document.title = '사이 — 해외 동료와 주고받는 업무 메시지';
    };
  }, [hasTransaction]);

  const copy = COPY[state];
  return (
    <main id="main" className="legal page-pad">
      <div className="wrap legal-inner">
        <article className="legal-doc" aria-live="polite">
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <p className="meta">
            <Link to="/refund">환불 정책</Link> · <Link to="/terms">이용약관</Link> · 문의{' '}
            <a href="mailto:asg21274@gmail.com">asg21274@gmail.com</a>
          </p>
        </article>
      </div>
    </main>
  );
}
