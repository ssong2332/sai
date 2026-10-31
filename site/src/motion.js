import { useEffect, useRef, useState } from 'react';

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * 스크롤 구독 — 스크롤·리사이즈 이벤트를 한 프레임에 한 번(rAF)으로 묶는다.
 * 🔴 구독 함수는 React 상태를 매 프레임 바꾸지 않는다. DOM 스타일(`--p`)을 직접 쓰거나,
 *    값이 바뀔 때만 setState 한다(60fps).
 */
const subscribers = new Set();
let frame = 0;

function flush() {
  frame = 0;
  for (const fn of subscribers) fn();
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(flush);
}

export function onScrollFrame(fn) {
  subscribers.add(fn);
  if (subscribers.size === 1) {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
  }
  fn();
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/** 최신 콜백을 담아 두는 ref — 구독을 다시 걸지 않고 콜백만 바꾼다. */
function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function useScrollFrame(fn, enabled = true) {
  const latest = useLatest(fn);
  useEffect(() => {
    if (!enabled) return undefined;
    return onScrollFrame(() => latest.current());
  }, [enabled, latest]);
}

/** 한 번 보이면 true — 등장·게이지 같은 1회성 모션용. 모션 줄이기면 처음부터 true. */
export function useInView(ref, { threshold = 0.25, rootMargin = '0px' } = {}) {
  const [seen, setSeen] = useState(prefersReducedMotion);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof window.IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const io = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold, rootMargin]);
  return seen;
}

/**
 * 지금 화면에 보이는지 — `useInView`와 달리 **나가면 다시 false**(1회성 아님). 화면 밖에서 타이머·깜빡임을 멈출 때 쓴다.
 * IntersectionObserver가 없으면 항상 true.
 */
export function useVisible(ref, { threshold = 0 } = {}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof window.IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const io = new window.IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return visible;
}

/**
 * 숫자 굴리기 — `run`이 true가 되면 0 → target으로 감속하며 올라간다(ease-out quart).
 * 모션 줄이기면 바로 target. 반환값은 지금 보여 줄 숫자.
 */
export function useCountUp(target, run, duration = 1400) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (!run) return undefined;
    if (prefersReducedMotion() || !duration) {
      setValue(target);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 4);
      setValue(Math.round(target * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, duration]);
  return value;
}
