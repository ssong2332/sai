import { useEffect, useMemo, useState } from 'react';
import { Link } from '../router.jsx';
import { createExtensionClient, describeCheckout, STORE_URL } from '../bridge.js';

/**
 * 요금제 (L36, 2026-10-29 사용자 결정 — Spec §0 수익화).
 * 🔴 2026-11-04 사용자 결정 — 결제 대행 Groble, **원화 가격 확정**(Pro 월 ₩7,900 · 연 ₩59,000 / 팀 1인 월 ₩13,900 · 연 ₩135,000,
 *    `docs/BillingDesign.md` 0-7). Groble 검수 「등록 내용 = 실제 판매 내용」에 맞춰 이 페이지 가격을 Groble 상품과 같게 둔다.
 *    결제는 확장 안 요금제 화면에서 연다(계정 연결 토큰이 필요하다) — 이 페이지에는 결제 버튼을 두지 않는다.
 * 🔴 (옛) 결제는 붙이지 않는다 — 아래 달러·「정밀」 서술은 2026-10-29 기록.
 * 🔴 **정하지 않은 숫자를 쓰지 않는다** — 유료 출시 후 하루 횟수(무료 20 · Pro 200 ·
 *    정밀 50 · 팀 1인당 같음)와 팀 1인당 가격(연 $96 · 월 $10)은 Spec의 **예정** 값이라 화면에도 반드시 「예정」을 붙인다(2026-10-29 사용자 결정). 정해진 것: 지금 하루 20회(2026-11-02 100 → 20, `functions/refineQuota.js` DAILY_REFINE_LIMIT —
 *    Worker가 mode를 가리지 않고 센다, `workers/refine/src/handler.js` consumeDailyQuota) · Pro 연 결제 $48(월 $4 꼴) · 월 결제 $6.
 * 🔴 2026-11-05 사용자 결정 「무료 프로모션 종료」 1단계(`BILLING_ENFORCED` — 하루 20회 · 빠른 모드만, 팀 기능은 팀 요금제,
 *    그 전 팀은 12-05까지 유예) + 2단계 「B안」(회신 하루 3 · 개인 용어 5 · 저장 문구 3 · 예약·회의 추천·학습은 Pro,
 *    `PLAN_FEATURES`). 보호 기능(민감정보 차단·본문 미저장)은 어느 플랜에서도 ✓.
 */
const PLANS = [
  {
    id: 'free',
    name: '무료',
    blurb: '혼자 쓰기 시작할 때',
    price: '₩0',
    unit: '빠른 모드 · 하루 20회',
    cta: { label: '지금 무료', note: '로그인만 하면 바로 써요 · 결제 정보 필요 없음' },
    lead: '무료로 쓰는 것',
    // 🔴 2026-11-05 사용자 결정 「무료 2단계 — B안」 — 숫자는 확장·Worker의 `PLAN_FEATURES`(`src/core/refine/quality.js`)와 같다.
    features: [
      '다듬기 · 뜻 풀기 — 하루 20회, 빠른 모드',
      '회신 초안 — 하루 3회',
      '상대 시간대 표시 · 퇴근 시간 안내',
      '개인 용어집 5개 · 저장 문구 3개',
      '민감정보 전송 전 차단 · 본문 미저장',
    ],
  },
  {
    id: 'pro',
    name: '개인 Pro',
    blurb: '매일 많이 보내는 사람',
    // 🔴 2026-11-04 원화 확정 — 연 ₩59,000 = 월 ₩4,917 꼴, 월 결제 ₩7,900 → 연 결제가 37% 싸다(1 − 59,000/94,800).
    // 큰 숫자는 월 환산(₩135,000은 카드 폭에서 두 줄로 깨졌다 — 2026-11-04 실화면) — 연 총액은 단위 줄에.
    price: { annual: '₩4,917', monthly: '₩7,900' },
    saveBadge: '37% 할인',
    unit: { annual: '월 · 연 ₩59,000 결제', monthly: '월 · 월 결제' },
    featured: true,
    // 🔴 2026-11-05 사용자 결정 「A안」 — 누르면 확장이 로그인 계정으로 그로블 결제창을 연다(`site:checkout`). 라벨은 주기별.
    cta: { label: { annual: 'Pro 연 결제하기', monthly: 'Pro 월 결제하기' }, note: '새 탭의 그로블에서 카드로 결제해요 · 확장 로그인 필요 · 부가세 포함' },
    lead: '무료의 모든 기능에 더해',
    features: [
      '하루 200회 · 그중 기본 10회 · 심층 3회',
      '기본 · 심층 품질 모드 — 더 꼼꼼하게 다듬기',
      '회신 초안 — 하루 횟수 안에서 제한 없이',
      '예약 알림 · 회의 시간 추천',
      '개인 용어집 · 저장 문구 — 개수 제한 없이',
      '수정 습관 학습 — 쓸수록 내 말투에 맞게',
    ],
  },
  {
    id: 'team',
    name: '팀',
    blurb: '해외 동료와 일하는 팀',
    // 🔴 2026-11-04 원화 확정 — 1인당 연 ₩135,000(월 ₩11,250 꼴) · 월 결제 ₩13,900 → 연 결제가 19% 싸다(1 − 135,000/166,800).
    //    좌석은 2~10석(Groble 상품이 좌석 수마다 하나) — 10석이 넘으면 문의.
    price: { annual: '₩11,250', monthly: '₩13,900' },
    saveBadge: '19% 할인',
    unit: { annual: '1인당 · 월 · 연 ₩135,000 결제', monthly: '1인당 · 월 · 월 결제' },
    // 🔴 2026-11-05 사용자 결정 「B안」 — 좌석을 고르고 누르면 확장이 팀장인 팀으로(없으면 「내 팀」을 만들어) 결제창을 연다.
    //    팀 탭 결제도 그대로 남는다(팀이 여러 개인 팀장 등).
    cta: { label: { annual: '팀 연 결제하기', monthly: '팀 월 결제하기' }, note: '새 탭의 그로블에서 카드로 결제해요 · 확장 로그인 필요 · 부가세 포함' },
    lead: '개인 Pro의 모든 기능에 더해',
    features: ['팀 용어집 공유', '팀 대시보드 — 협업 지표 합계', '팀원 관리', '팀 기본 품질 모드 지정'],
  },
];

/** 비교표 — true/false는 ✓/–, 문자열은 그대로. 「예정」 칸은 유료 출시 때 기준이다. */
const COMPARE = [
  {
    group: '쓰기와 읽기',
    rows: [
      ['다듬기 · 뜻 풀기', true, true, true],
      ['회신 초안', '하루 3회', true, true],
      ['하루 횟수(다듬기 · 뜻 풀기 · 회신 합산)', '20회', '200회(기본 10 · 심층 3)', '1인당 200회(기본 20 · 심층 5)'],
      ['품질 모드', '빠른', '빠른 · 기본 · 심층', '빠른 · 기본 · 심층 · 팀 기본 지정'],
      ['상대 시간대 표시 · 퇴근 시간 안내', true, true, true],
      ['예약 알림 · 회의 시간 추천', false, true, true],
      ['민감정보 전송 전 차단', true, true, true],
    ],
  },
  {
    group: '맞춤',
    rows: [
      ['개인 용어집 · 저장 문구', '5개 · 3개', '제한 없음', '제한 없음'],
      ['수정 습관 학습', false, true, true],
      ['팀 용어집 공유', false, false, true],
    ],
  },
  {
    group: '팀',
    rows: [
      ['팀 대시보드(협업 지표 합계)', false, false, true],
      ['팀원 관리', false, false, true],
    ],
  },
  {
    group: '데이터',
    rows: [
      ['메시지 본문 서버 미저장', true, true, true],
      ['AI 학습에 쓰지 않음', true, true, true],
    ],
  },
];

const FAQ = [
  {
    q: '무료로는 무엇을 쓸 수 있나요?',
    a: '다듬기 · 뜻 풀기를 빠른 모드로 하루 20회, 회신 초안을 하루 3회 쓸 수 있어요. 상대 시간대 표시와 퇴근 시간 안내도 무료예요. 개인 용어집은 5개, 저장 문구는 3개까지 저장할 수 있어요. 기본 · 심층 모드 · 하루 200회 · 예약 알림 · 회의 시간 추천 · 수정 습관 학습은 개인 Pro, 팀 용어집 · 팀 대시보드 · 팀원 관리는 팀 요금제예요. 결제는 이 페이지에서 바로 할 수 있어요(확장 설정 「요금제」·사이드패널 「팀」 탭에서도 돼요). 팀이 아직 없으면 결제할 때 「내 팀」이 자동으로 만들어져요.',
  },
  {
    q: '이미 만든 팀은 어떻게 되나요?',
    a: '2026년 11월 5일 전에 만든 팀은 12월 5일까지 지금처럼 쓸 수 있어요. 그 뒤로는 팀장이 팀 요금제를 결제해야 팀 용어집 · 팀 대시보드가 다시 열려요. 팀 데이터는 지우지 않아요. 11월 5일 이후 새로 만든 팀은 결제하면 바로 열려요.',
  },
  {
    q: '무료에서 용어집을 5개 넘게 만들어 두었어요. 지워지나요?',
    a: '지우지 않아요. 이미 저장한 용어 · 저장 문구 · 예약 · 학습 기록은 그대로 남아요. 무료에서는 새로 추가하는 것만 막고, 다듬을 때는 개인 용어를 앞의 5개까지 써요. Pro나 팀으로 올리면 남아 있던 것을 바로 다시 써요.',
  },
  {
    q: '어떤 결제 수단을 쓸 수 있나요?',
    a: '그로블(Groble) 결제창에서 카드로 결제해요. 매달·매년 자동으로 결제되는 정기결제라 카카오페이 · 네이버페이는 쓸 수 없어요. 가격은 부가세를 포함한 원화 금액이에요. 카드 정보는 사이가 받지 않아요. 결제일로부터 7일 안에는 전액 환불해 드려요.',
  },
  {
    q: 'Pro · 팀 요금제에서도 메시지 본문을 저장하지 않나요?',
    a: '네. 어느 플랜이든 메시지 본문은 사이 서버와 데이터베이스에 저장하지 않아요. 자세한 내용은 개인정보처리방침에 있어요.',
    link: { to: '/privacy', label: '개인정보처리방침 보기' },
  },
  {
    q: '하루 횟수를 다 쓰면 어떻게 되나요?',
    a: '그날은 다듬기 · 뜻 풀기 · 회신 초안을 더 할 수 없고, 다음 날 다시 채워져요. 하루 횟수는 이 셋을 합쳐 세요. 저장 문구 · 용어집(Pro는 예약 알림도)은 그대로 쓸 수 있어요. 무료는 하루 20회 · 회신 초안 3회예요. 개인 Pro와 팀은 1인당 하루 200회예요. 기본 · 심층 모드 횟수를 다 쓰면 그날은 빠른 모드로 다듬어요.',
  },
];

function Cell({ value }) {
  if (value === true) {
    return (
      <span className="pr-yes" aria-label="포함">
        ✓
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="pr-no" aria-label="없음">
        –
      </span>
    );
  }
  return <span className="pr-text">{value}</span>;
}

/** 결제 주기 — 연 결제가 기본(DeepL과 같다). 값이 주기마다 다른 플랜 카드 안에만 그린다(개인 Pro · 팀). 할인율은 플랜마다 달라 `saveBadge`로 받는다. */
const BILLING = [
  { id: 'monthly', label: '월 결제' },
  { id: 'annual', label: '연 결제', save: true },
];

/** 팀 좌석 — 2~10석(그로블 상품이 좌석 수마다 하나, 확장 `TEAM_SEATS_MIN`·`MAX`와 같다). 1인 가격은 확장 `PRICES_KRW`와 같다. */
const TEAM_SEATS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const TEAM_SEAT_PRICE = { annual: 135000, monthly: 13900 };
const krw = (n) => `₩${n.toLocaleString('ko-KR')}`;

const byBilling = (value, billing) => (value && typeof value === 'object' ? value[billing] : value);

export default function Pricing() {
  const [open, setOpen] = useState(0);
  const [billing, setBilling] = useState('annual');
  const client = useMemo(() => createExtensionClient(), []);
  /** 카드별 결제 안내 — { [planId]: {tone, text, action?} } */
  const [notice, setNotice] = useState({});
  const [busy, setBusy] = useState(null);
  const [seats, setSeats] = useState(2);

  const onCta = async (planId) => {
    if ((planId !== 'pro' && planId !== 'team') || busy) return;
    setBusy(planId);
    setNotice({ [planId]: { tone: 'info', text: '확장에 결제창을 요청하는 중이에요…' } });
    try {
      const result = await client.checkout({ plan: planId, interval: billing === 'annual' ? 'year' : 'month', seats });
      setNotice({ [planId]: describeCheckout(result) });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    document.title = '요금제 — 사이';
    return () => {
      document.title = '사이 — 해외 동료와 주고받는 업무 메시지';
    };
  }, []);

  return (
    <main id="main" className="pricing page-pad">
      <div className="wrap">
        <header className="pr-head">
          <p className="pr-eyebrow">요금제</p>
          <h1 className="pr-title">필요한 만큼 골라 쓰세요</h1>
          <p className="pr-lede">
            다듬기 · 뜻 풀기는 무료로 시작해요. 더 많이 · 더 꼼꼼하게 다듬으려면 개인 Pro를, 팀 용어집과 대시보드가 필요하면 팀 요금제를 고르세요.
          </p>
        </header>

        <section className="pr-plans" aria-label="플랜">
          {PLANS.map((plan) => (
            <article key={plan.id} className={`pr-card${plan.featured ? ' featured' : ''}`}>
              {plan.featured && <p className="pr-flag">추천</p>}
              <h2 className="pr-name">{plan.name}</h2>
              <p className="pr-blurb">{plan.blurb}</p>
              {/* 결제 주기는 값이 주기마다 다른 플랜 카드 안에만(2026-10-29 사용자 지적 — 카드 밖에 두면 무료·팀에도 걸려 보인다) */}
              {typeof plan.price === 'object' ? (
                <div className="seg pr-billing" role="radiogroup" aria-label="결제 주기">
                  {BILLING.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      role="radio"
                      aria-checked={billing === b.id}
                      onClick={() => setBilling(b.id)}
                    >
                      {b.label}
                      {b.save && plan.saveBadge && <span className="pr-save">{plan.saveBadge}</span>}
                    </button>
                  ))}
                </div>
              ) : (
                // 세 카드의 가격·버튼 줄을 맞추는 빈 자리(넓은 화면에서만 — 한 줄로 쌓이면 숨긴다)
                <div className="pr-billing-spacer" aria-hidden="true" />
              )}
              <p className="pr-price">
                <span className="num">{byBilling(plan.price, billing)}</span>
                <span className="pr-unit">{byBilling(plan.unit, billing)}</span>
              </p>
              {plan.id === 'team' && (
                <div className="pr-seats">
                  <label htmlFor="pr-seat-count">좌석</label>
                  <select id="pr-seat-count" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                    {TEAM_SEATS.map((n) => (
                      <option key={n} value={n}>
                        {n}석
                      </option>
                    ))}
                  </select>
                  <span className="pr-seats-total">
                    합계 {krw(TEAM_SEAT_PRICE[billing] * seats)} / {billing === 'annual' ? '년' : '월'}
                  </span>
                </div>
              )}
              {plan.id === 'free' ? (
                <button type="button" className="btn primary pr-cta" aria-disabled="true">
                  {plan.cta.label}
                </button>
              ) : (
                <button
                  type="button"
                  className={`btn ${plan.id === 'pro' ? 'primary' : 'ghost'} press pr-cta`}
                  disabled={busy !== null}
                  onClick={() => onCta(plan.id)}
                >
                  {byBilling(plan.cta.label, billing)}
                </button>
              )}
              <p className="pr-note">{plan.cta.note}</p>
              <p className={`pr-notice${notice[plan.id] ? ` ${notice[plan.id].tone}` : ''}`} role="status" aria-live="polite">
                {notice[plan.id]?.text}
                {notice[plan.id]?.action === 'install' && (
                  <>
                    {' '}
                    <a href={STORE_URL} target="_blank" rel="noopener noreferrer">
                      Chrome 웹 스토어에서 설치
                    </a>
                  </>
                )}
              </p>
              <hr className="pr-rule" />
              <p className="pr-lead">{plan.lead}</p>
              <ul className="pr-features">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {plan.bonus && (
                <>
                  <p className="pr-lead pr-lead-bonus">{plan.bonus.lead}</p>
                  <ul className="pr-features bonus">
                    {plan.bonus.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </>
              )}
            </article>
          ))}
        </section>

        <section className="pr-compare" aria-labelledby="pr-compare-title">
          <h2 id="pr-compare-title" className="pr-section-title">
            플랜 비교
          </h2>
          <div className="pr-table-scroll">
            <table className="pr-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">기능</span>
                  </th>
                  {PLANS.map((p) => (
                    <th key={p.id} scope="col">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              {COMPARE.map((section) => (
                <tbody key={section.group}>
                  <tr className="pr-group">
                    <th scope="rowgroup" colSpan={4}>
                      {section.group}
                    </th>
                  </tr>
                  {section.rows.map(([label, ...cells]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {cells.map((value, i) => (
                        <td key={PLANS[i].id}>
                          <Cell value={value} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="pr-footnote">가격은 부가세 포함이에요. 무료 한도(회신 초안 하루 3회 · 개인 용어 5개 · 저장 문구 3개)는 바뀌면 이 페이지에 먼저 알려 드려요.</p>
        </section>

        <section className="pr-faq" aria-labelledby="pr-faq-title">
          <h2 id="pr-faq-title" className="pr-section-title">
            자주 묻는 질문
          </h2>
          <ul>
            {FAQ.map((item, i) => {
              const expanded = open === i;
              return (
                <li key={item.q}>
                  <button
                    type="button"
                    className="pr-q"
                    aria-expanded={expanded}
                    aria-controls={`pr-a-${i}`}
                    onClick={() => setOpen(expanded ? -1 : i)}
                  >
                    {item.q}
                    <span className="pr-chev" aria-hidden="true" />
                  </button>
                  <div id={`pr-a-${i}`} className="pr-a" hidden={!expanded}>
                    <p>{item.a}</p>
                    {item.link && <Link to={item.link.to}>{item.link.label}</Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
