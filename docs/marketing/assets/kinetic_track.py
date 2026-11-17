"""키네틱 홍보 영상(kinetic.html) 전용 배경음악·효과음 (2026-11-03 2판).

🔴 2026-11-03 사용자 지적 「브금 노래가 별로고 효과음도 다듬어」 — 릴스용 F–C–Dm–B♭ 팝(make_audio.py)을 그대로 쓰던 것을
애플 광고풍 짧은 일렉트로닉 그루브로 바꿨다. make_kinetic_audio.py가 큐 파일 없이 불릴 때(=kinetic.html)만 쓴다.

100bpm(한 박 0.6초 · 한 마디 2.4초 — kinetic.html 컷이 모두 이 박자 위). 진행 Am9 → Fmaj9 → Cadd9 → G6, 끝 장은 Cadd9로 풀린다.
  0.0–2.4  들어오는 마디: 킥 1·3박, 필터 닫힌 스탭, 끝에 스네어 롤 → 2.4에서 터진다
  2.4–12.0 본 그루브: 4박 킥 + 사이드체인, 클랩 2·4, 16분 하이햇·엇박 오픈햇, 엇박 베이스, 당김음 스탭, FM 벨 멜로디
  12.0–12.9 12.3에서 음악이 멈추고 상승음·스네어 롤만 → 12.9 끝 장 화음(Cadd9)이 15초까지 울린다
효과음: 장면 컷 = 짧고 밝은 타격(킥과 겹쳐 저음은 뺐다) · 글자 등장 = 음정 있는 「톡」(C 장조 5음) · 전환 = 컷 직전에 차오르는 바람(좌→우) ·
타이핑 = 키 소리 두 겹 · 끝 장 = 깊은 타격 + 반짝임. 모두 직접 합성 — 저작권 없음.
"""
import numpy as np
from scipy.signal import butter, fftconvolve, lfilter

SR = 44100
BPM = 100
BEAT = 60 / BPM
BAR = BEAT * 4
rng = np.random.default_rng(23)

CHORDS = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [55, 60, 62, 64, 67], [55, 59, 62, 64, 67]]  # Am9 Fmaj9 Cadd9 G6
ROOTS = [33, 29, 36, 31]
FINAL = [48, 55, 60, 62, 64, 67, 72]  # Cadd9 넓게
STABS = [0, 0.75, 1.5, 2.5, 3.25]  # 3-3-2 당김음(박)
BELL = [(0, 76), (0.75, 79), (1.5, 81), (2.5, 79), (3, 76), (3.5, 74)]  # (박, 음)
PENTA = [84, 86, 88, 91, 93]  # 글자 「톡」 음정


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def ts(sec):
    return np.arange(int(sec * SR)) / SR


def filt(x, kind, f, order=2):
    w = np.array(f) / (SR / 2)
    b, a = butter(order, w, btype=kind)
    return lfilter(b, a, x)


def add(buf, start, sig, pan=0.0):
    """buf: (n, 2). pan -1(왼)~1(오)."""
    s = int(round(start * SR))
    if s >= len(buf) or s + len(sig) <= 0:
        return
    if s < 0:
        sig, s = sig[-s:], 0
    e = min(len(buf), s + len(sig))
    g = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
    if sig.ndim == 1:
        buf[s:e] += sig[: e - s, None] * g
    else:
        buf[s:e] += sig[: e - s]


def adsr(n, a, d, s, r):
    e = np.full(n, s, dtype=float)
    A, D, R = int(a * SR), int(d * SR), int(r * SR)
    if A:
        e[:A] = np.linspace(0, 1, A)
    if D:
        e[A:A + D] = np.linspace(1, s, len(e[A:A + D]))
    if R:
        e[-R:] *= np.linspace(1, 0, R)
    return e


def supersaw(freq, t, voices=7, detune=0.016):
    """좌우로 퍼진 7음 톱니 — (n, 2)."""
    L = np.zeros(len(t))
    R = np.zeros(len(t))
    for k in range(voices):
        off = (k - (voices - 1) / 2) / ((voices - 1) / 2)
        ph = (freq * (1 + detune * off) * t + rng.random()) % 1.0
        v = 2 * ph - 1
        L += v * (1 - off) / 2
        R += v * (1 + off) / 2
    return np.stack([L, R], axis=1) / voices


def reverb(x, seconds, mix, bright=6000):
    n = int(seconds * SR)
    out = np.empty_like(x)
    for ch in range(x.shape[1]):
        ir = filt(rng.standard_normal(n) * np.exp(-ts(seconds) * (6.9 / seconds)), "low", bright)
        wet = fftconvolve(x[:, ch], ir)[: len(x)]
        wet *= np.sqrt(np.mean(x[:, ch] ** 2) + 1e-12) / (np.sqrt(np.mean(wet ** 2)) + 1e-12)
        out[:, ch] = x[:, ch] * (1 - mix) + wet * mix
    return out


# ── 악기 ──────────────────────────────────────────
def kick():
    t = ts(0.4)
    body = np.sin(2 * np.pi * np.cumsum(50 + 140 * np.exp(-t * 35)) / SR) * np.exp(-t * 13)
    click = filt(rng.standard_normal(len(t)), "high", 3000) * np.exp(-t * 400) * 0.5
    return np.tanh((body + click) * 1.6) * 0.55


def clap():
    t = ts(0.35)
    noise = filt(rng.standard_normal(len(t)), "band", [1000, 5000])
    e = np.zeros(len(t))
    for k, d in enumerate((0.0, 0.009, 0.018)):  # 손뼉 세 겹
        s = int(d * SR)
        e[s:] += np.exp(-(t[: len(t) - s]) * (180 if k < 2 else 18))
    body = np.sin(2 * np.pi * 200 * t) * np.exp(-t * 40) * 0.25
    return (noise * e * 0.5 + body)


def snare(gain=1.0):
    t = ts(0.18)
    tone = np.sin(2 * np.pi * np.cumsum(240 * (1 + 0.3 * np.exp(-t * 60))) / SR) * np.exp(-t * 30)
    noise = filt(rng.standard_normal(len(t)), "band", [1500, 9000]) * np.exp(-t * 28)
    return (tone * 0.4 + noise * 0.5) * gain


def hat(open_=False):
    t = ts(0.3 if open_ else 0.05)
    # 808식 금속음 — 비정수 배 사각파 여섯 개
    metal = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0))
    x = filt(metal + rng.standard_normal(len(t)) * 2, "high", 7000)
    return x * np.exp(-t * (14 if open_ else 110)) * 0.06


def stab(chord, length, bright):
    t = ts(length)
    x = sum(supersaw(midi(m), t) for m in chord)
    cutoff = 400 + bright * 5200 * np.exp(-t * 14)  # 필터 엔벨로프 — 「팍」 하고 닫힌다
    out = np.empty_like(x)
    for ch in range(2):  # 짧은 구간마다 저역 통과(시간 변화 필터 근사)
        y = np.zeros(len(t))
        hop = 256
        zi = None
        for i in range(0, len(t), hop):
            b, a = butter(2, min(0.99, cutoff[i] / (SR / 2)), btype="low")
            if zi is None:
                zi = np.zeros(max(len(a), len(b)) - 1)
            y[i:i + hop], zi = lfilter(b, a, x[i:i + hop, ch], zi=zi)
        out[:, ch] = y
    return out * adsr(len(t), 0.003, 0.12, 0.35, 0.06)[:, None] * 0.34


def bass_note(root, length):
    t = ts(length)
    f = midi(root)
    sub = np.sin(2 * np.pi * f * t)
    grit = filt(np.tanh(np.sin(2 * np.pi * f * 2 * t) * 3), "low", 900)  # 휴대폰 스피커에도 들리게 배음
    return (sub * 0.45 + grit * 0.35) * adsr(len(t), 0.004, 0.08, 0.8, 0.04) * 0.6


def bell(note, length=0.9, gain=1.0):
    t = ts(length)
    f = midi(note)
    idx = 2.2 * np.exp(-t * 7)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 4.5)
    return x * 0.2 * gain


def pad(chord, length):
    t = ts(length)
    x = sum(supersaw(midi(m), t, voices=5, detune=0.008) for m in chord)
    x = np.stack([filt(x[:, c], "low", 1800) for c in range(2)], axis=1)
    return x * adsr(len(t), 0.15, 0.4, 0.8, 1.2)[:, None] * 0.12


# ── 음악 ──────────────────────────────────────────
def music(total, final_at=12.9, stop_at=12.3):
    n = int(total * SR)
    drums, stabs, bass, bells, hats = (np.zeros((n, 2)) for _ in range(5))
    pump = np.ones(n)
    K = kick()

    def kick_at(t0, g=1.0):
        add(drums, t0, K * g)
        d = np.minimum(1, 0.25 + ts(0.3) / 0.25 * 0.75)  # 사이드체인
        s = int(t0 * SR)
        e = min(n, s + len(d))
        pump[s:e] = np.minimum(pump[s:e], d[: e - s])

    for b in range(int(np.ceil(stop_at / BAR))):
        t0 = b * BAR
        chord, root = CHORDS[b % 4], ROOTS[b % 4]
        bright = 0.5 if b == 0 else 1.0  # 첫 마디는 필터를 반쯤 닫아 둔다
        for beat in STABS:
            at = t0 + beat * BEAT
            if at < stop_at:
                add(stabs, at, stab(chord, BEAT * 0.7, bright))
        for k in range(16):  # 16분 하이햇
            at = t0 + k * BEAT / 4
            if at >= stop_at or (b == 0 and k % 2):
                continue
            add(hats, at, hat() * (1.0 if k % 4 == 2 else 0.55), pan=0.25)
        if b == 0:
            kick_at(t0)
            kick_at(t0 + 2 * BEAT)
            for k in range(8):  # 1.2~2.4 스네어 롤, 점점 크게 → 2.4에서 터진다
                add(drums, t0 + 2 * BEAT + k * BEAT / 4, snare(0.15 + 0.85 * k / 7), pan=-0.1)
            continue
        for k in range(4):
            at = t0 + k * BEAT
            if at >= stop_at:
                continue
            kick_at(at)
            if k in (1, 3):
                add(drums, at, clap() * 0.8, pan=0.05)
            if at + BEAT / 2 < stop_at:
                add(hats, at + BEAT / 2, hat(True) * 0.8, pan=-0.3)
                add(bass, at + BEAT / 2, bass_note(root, BEAT * 0.42))  # 엇박 베이스
        for beat, note in BELL:
            at = t0 + beat * BEAT
            if b >= 2 and at < stop_at:
                add(bells, at, bell(note))
    # 12.3~12.9 스네어 롤(16분, 점점 크게)
    k = 0
    while stop_at + k * BEAT / 4 < final_at - 0.01:
        add(drums, stop_at + k * BEAT / 4, snare(0.4 + 0.15 * k), pan=0.1 * (-1) ** k)
        k += 1
    # 끝 장 — 킥 + Cadd9 패드 + 높은 벨
    add(drums, final_at, K * 1.1)
    add(stabs, final_at, pad(FINAL, total - final_at))
    add(stabs, final_at, stab(FINAL, BEAT, 1.0))
    add(bass, final_at, bass_note(36, 1.4) * adsr(int(1.4 * SR), 0, 0.3, 0.6, 0.9))
    for i, (d, m) in enumerate(((0, 84), (0.3, 79), (0.6, 88))):
        add(bells, final_at + d, bell(m, 1.6, 0.9 - 0.2 * i))

    # 벨 핑퐁 딜레이(점8분)
    dl = int(BEAT * 0.75 * SR)
    echo = np.zeros_like(bells)
    echo[dl:, 1] += bells[:-dl, 0] * 0.35
    echo[2 * dl:, 0] += bells[:-2 * dl, 0] * 0.18
    bells = reverb(bells + echo, 1.8, 0.35)
    stabs = reverb(stabs, 1.2, 0.22) * pump[:, None]
    bass = np.stack([filt(bass[:, c], "low", 1200) for c in range(2)], axis=1) * pump[:, None]
    mix = drums * 0.85 + stabs + bass + bells + hats
    mix = reverb(mix, 0.5, 0.06, 9000)  # 같은 방에 있는 느낌
    mix = np.stack([filt(mix[:, c], "high", 35) for c in range(2)], axis=1)  # 들리지 않는 초저역은 뺀다
    return np.tanh(mix * 1.3) / 1.3


# ── 효과음 ────────────────────────────────────────
def impact(strength=1.0, deep=False):
    t = ts(1.2 if deep else 0.25)
    snap = filt(rng.standard_normal(len(t)), "band", [2500, 12000]) * np.exp(-t * 90)
    body = np.sin(2 * np.pi * 180 * t) * np.exp(-t * 45) * 0.3
    x = snap * 0.35 + body
    if deep:  # 끝 장: 깊은 저음 + 긴 꼬리
        x = x + np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 6)) / SR) * np.exp(-t * 2.8) * 0.7
    return x * strength


def tok(note, gain=1.0):
    t = ts(0.07)
    f = midi(note)
    x = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.5 * np.exp(-t * 120))) / SR) * np.exp(-t * 55)
    return x * 0.18 * gain


def whoosh(length=0.42, pan_from=-0.7):
    """컷 직전까지 차오르고 컷에서 뚝 끊긴다 — (n, 2)."""
    t = ts(length)
    p = t / length
    noise = rng.standard_normal(len(t))
    y = np.zeros(len(t))
    hop = 512
    for i in range(0, len(t), hop):  # 밴드 중심 500 → 6000Hz
        c = 500 * 12 ** p[i]
        y[i:i + hop] = filt(noise[max(0, i - 2048):i + hop], "band", [c * 0.6, min(c * 1.6, 20000)])[-len(noise[i:i + hop]):]
    amp = p ** 2.2 * (1 - np.clip((p - 0.97) / 0.03, 0, 1))
    pan = pan_from + (-2 * pan_from) * p
    g = np.stack([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)], axis=1) * np.sqrt(2)
    return (y * amp)[:, None] * g * 0.3


def key_click():
    t = ts(0.06)
    click = filt(rng.standard_normal(len(t)), "band", [3000, 10000]) * np.exp(-t * 300)
    thock = np.sin(2 * np.pi * rng.uniform(380, 520) * t) * np.exp(-t * 90)
    return (click * 0.5 + thock * 0.35) * rng.uniform(0.7, 1.0) * 0.4


def riser(length):
    t = ts(length)
    p = t / length
    tone = np.sin(2 * np.pi * np.cumsum(300 * 6 ** p) / SR) * 0.12
    noise = filt(rng.standard_normal(len(t)), "high", 3000) * 0.18
    return (tone + noise) * p ** 2 * (1 - np.clip((p - 0.95) / 0.05, 0, 1))


def sparkle(length=1.5):
    t = ts(length)
    x = sum(np.sin(2 * np.pi * midi(m) * t + rng.random() * 6) * np.exp(-t * (3 + i)) for i, m in enumerate((96, 100, 103, 108)))
    return filt(x, "high", 2000) * 0.05


def sfx(total, hits, cuts, typing, riser_at, final_at):
    n = int(total * SR)
    fx = np.zeros((n, 2))
    cutset = {round(c, 2) for c in cuts}
    for i, c in enumerate(cuts):
        if final_at is not None and abs(c - final_at) < 0.01:
            continue
        add(fx, c, impact(0.8))
        add(fx, c - 0.4, whoosh(0.4, -0.7 if i % 2 == 0 else 0.7))
    k = 0
    for h in hits:
        if round(h, 2) in cutset or (final_at is not None and abs(h - final_at) < 0.01):
            continue
        if riser_at and riser_at[0] <= h < riser_at[0] + riser_at[1]:
            continue  # 상승음 구간은 비운다
        if h < 0.05:  # 첫 프레임은 타격으로 연다
            add(fx, h, impact(0.8))
            continue
        add(fx, h, tok(PENTA[k % len(PENTA)]), pan=0.3 * ((k % 3) - 1))
        k += 1
    if typing:
        a, b, cnt = typing
        for i in range(cnt):
            add(fx, a + (b - a) * i / cnt + rng.uniform(-0.012, 0.012), key_click(), pan=rng.uniform(-0.2, 0.2))
    if riser_at:
        add(fx, riser_at[0], riser(riser_at[1]))
    if final_at is not None:
        add(fx, final_at, impact(1.0, deep=True))
        add(fx, final_at + 0.05, sparkle(), pan=0.2)
    return reverb(fx, 0.8, 0.12)
