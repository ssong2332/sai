import { useEffect, useState } from 'react';

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
 * 스크롤 연동 트랙 — 등록된 요소에 `--p`(0~1)를 직접 쓴다. React 상태를 거치지 않는다
 * (스크롤마다 다시 그리면 60fps를 못 지킨다). CSS는 `--p`로 transform만 바꾼다.
 * 🔴 모션 줄이기면 `--p: 1`로 고정 — 처음부터 다 펼친 상태로 읽힌다.
 */
const tracked = new Set();
let ticking = false;

function update() {
  ticking = false;
  const vh = window.innerHeight || 800;
  for (const el of tracked) {
    const top = el.getBoundingClientRect().top;
    const start = vh * 0.95;
    const end = vh * 0.5;
    const p = Math.min(1, Math.max(0, (start - top) / (start - end)));
    el.style.setProperty('--p', p.toFixed(3));
  }
}

function onScroll() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(update);
  }
}

export function useScrollTrack(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (prefersReducedMotion()) {
      el.style.setProperty('--p', '1');
      return undefined;
    }
    tracked.add(el);
    if (tracked.size === 1) {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
    }
    update();
    return () => {
      tracked.delete(el);
      if (tracked.size === 0) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      }
    };
  }, [ref]);
}

/** 한 번 보이면 true — 게이지 같은 1회성 모션용. */
export function useInView(ref, { threshold = 0.4 } = {}) {
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
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}
