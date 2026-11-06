import { useEffect } from 'react';
import { Link } from '../router.jsx';

/**
 * `/checkout` — 옛 Paddle 결제창 자리(2026-10-31~11-04). 🔴 2026-11-06 안내 페이지로 바꿨다.
 *
 * 결제는 2026-11-04부터 그로블이다(요금제 페이지 · 확장 → Worker `/v1/billing/checkout` → 그로블 결제창).
 * 이 주소는 지우지 않는다 — Worker는 그로블 설정이 빠지면 Paddle 거래(`?_ptxn=`)로 이 주소를 돌려줄 수 있는데,
 * 그 경로는 샌드박스라 실제 결제가 아니다. 여기서 Paddle.js·클라이언트 토큰을 싣지 않고 요금제 페이지로 안내만 한다.
 */
export default function Checkout() {
  useEffect(() => {
    document.title = '결제 — 사이';
    return () => {
      document.title = '사이 — 해외 동료와 주고받는 업무 메시지';
    };
  }, []);

  return (
    <main id="main" className="legal page-pad">
      <div className="wrap legal-inner">
        <article className="legal-doc">
          <h1>결제는 요금제 페이지에서 해요</h1>
          <p>
            <Link to="/pricing">요금제</Link>에서 Pro나 팀을 고르면 결제창이 열려요. 사이 확장이 설치되어 있고 로그인되어
            있어야 해요.
          </p>
          <p className="meta">
            <Link to="/refund">환불 정책</Link> · <Link to="/terms">이용약관</Link> · 문의{' '}
            <a href="mailto:asg21274@gmail.com">asg21274@gmail.com</a>
          </p>
        </article>
      </div>
    </main>
  );
}
