"""릴스 소리 만들기 — 배경음악·효과음을 직접 합성하고(저작권 없음), 원하면 내레이션을 얹는다 (2026-11-03).

쓰는 법(저장소 루트):
  python -I docs/marketing/assets/make_audio.py <v1|v2> <출력.wav> [내레이션 폴더]
  → 마지막 줄에 장면 길이(쉼표 목록)를 찍는다. 그 값을 make_video.py 네 번째 인자로 넘겨 영상 길이를 맞춘다.
내레이션 폴더에는 <v1|v2>-1.wav … -5.wav (`make_voice.py` 결과) — 없으면 음악·효과음만.

음악: 112bpm, F → C → Dm → B♭ 반복. 사이드체인 패드 + 당김음 베이스 + 킥·클랩·하이햇 + 점8분 딜레이 멜로디, 잔향.
효과음: 장면이 들어올 때 짧은 「뽁」, 나갈 때 바람 소리. 내레이션이 나오는 동안 음악을 25%로 낮춘다(목소리가 약 10dB 크게).
필요: numpy · scipy.
"""
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter

SR = 44100
DEFAULT = [3.2, 2.8, 4.4, 3.6, 3.2]  # make_video.py DURATIONS와 같다
FADE = 0.35
BPM = 112
BEAT = 60 / BPM
rng = np.random.default_rng(7)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


# 🔴 2026-11-03 사용자 지적 「배경음악이 별로」 — 96bpm 사인파 패드(잔잔·밋밋)를 112bpm 밝은 팝으로 바꿨다.
# 진행 F → C → Dm → B♭ (I–V–vi–IV, add9 보이싱). 첫 마디는 패드·하이햇만(시작), 둘째 마디부터 드럼·베이스·멜로디.
CHORDS = [[53, 57, 60, 67], [48, 55, 60, 62], [50, 57, 60, 64], [46, 53, 58, 60]]
ROOTS = [29, 36, 26, 34]
HOOK = [(0, 72), (0.5, 74), (1, 77), (2, 76), (2.5, 74), (3, 72), (4, 69), (4.5, 72), (5, 74), (6, 72), (7, 69)]  # (박, 음) 두 마디


def env(n, attack, release):
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def lowpass(x, cutoff, order=2):
    b, a = butter(order, cutoff / (SR / 2), btype="low")
    return lfilter(b, a, x)


def band(x, lo, hi):
    b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], btype="band")
    return lfilter(b, a, x)


def add(buf, start, sig):
    s = int(start * SR)
    if s >= len(buf) or s < 0:
        return
    e = min(len(buf), s + len(sig))
    buf[s:e] += sig[: e - s]


def saw(freq, t, voices=3, detune=0.006):
    out = 0
    for k in range(voices):
        f = freq * (1 + detune * (k - (voices - 1) / 2))
        ph = (f * t + rng.random()) % 1.0
        out = out + (2 * ph - 1)
    return out / voices


def reverb(x, seconds=1.4, mix=0.25):
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 4.5)
    ir = lowpass(ir, 5000)
    wet = fftconvolve(x, ir)[: len(x)]
    wet *= np.max(np.abs(x)) / (np.max(np.abs(wet)) + 1e-9)
    return x * (1 - mix) + wet * mix


def music(total):
    n = int(total * SR)
    pad, bass, drums, lead, hats = (np.zeros(n) for _ in range(5))
    pump = np.ones(n)
    bar = BEAT * 4
    tb = np.arange(int(bar * SR)) / SR
    bars = int(total / bar) + 1
    for b in range(bars):
        chord, root, t0 = CHORDS[b % 4], ROOTS[b % 4], b * bar
        add(pad, t0, sum(saw(midi(m), tb) for m in chord) * env(len(tb), 0.08, 0.25) * 0.10)
        for k in range(8):  # 하이햇 8분음표(세기 흔들기)
            th = np.arange(int(0.04 * SR)) / SR
            add(hats, t0 + k * BEAT / 2, rng.standard_normal(len(th)) * np.exp(-th * 90) * (0.05 if k % 2 else 0.03))
        if b == 0:
            continue  # 첫 마디는 들어오는 부분
        for k in range(4):
            tk = np.arange(int(0.25 * SR)) / SR
            if k in (0, 2):  # 킥 + 사이드체인
                kick = np.sin(2 * np.pi * (48 + 110 * np.exp(-tk * 28)) * tk) * np.exp(-tk * 11)
                kick[: int(0.004 * SR)] += 0.4
                add(drums, t0 + k * BEAT, kick * 0.55)
                d = np.minimum(1, 0.35 + tk / 0.22 * 0.65)
                s = int((t0 + k * BEAT) * SR)
                pump[s: s + len(d)] = np.minimum(pump[s: s + len(d)], d[: max(0, n - s)])
            else:  # 클랩 2·4박
                tc = np.arange(int(0.2 * SR)) / SR
                clap = band(rng.standard_normal(len(tc)), 900, 4500) * np.exp(-tc * 22)
                clap += 0.3 * np.sin(2 * np.pi * 190 * tc) * np.exp(-tc * 30)
                add(drums, t0 + k * BEAT, clap * 0.35)
        for beat in (0, 1.5, 2, 3, 3.5):  # 베이스 당김음
            tl = np.arange(int(BEAT * 0.45 * SR)) / SR
            add(bass, t0 + beat * BEAT, saw(midi(root + 12), tl, voices=1) * env(len(tl), 0.005, 0.05) * 0.5)
        half = ((b - 1) % 2) * 4  # 멜로디 두 마디 중 이번 마디가 앞(0)인지 뒤(4)인지
        for beat, note in HOOK:
            if half <= beat < half + 4:
                tp = np.arange(int(0.6 * SR)) / SR
                f = midi(note)
                pluck = (np.sin(2 * np.pi * f * tp) + 0.4 * np.sin(4 * np.pi * f * tp) + 0.15 * np.sin(6 * np.pi * f * tp)) * np.exp(-tp * 6)
                add(lead, t0 + (beat - half) * BEAT, pluck * 0.22)
    pad = reverb(lowpass(pad, 1400), 1.6, 0.35) * pump
    bass = lowpass(bass, 380) * pump
    delay = int(BEAT * 0.75 * SR)  # 점8분 딜레이
    echo = np.zeros(n)
    echo[delay:] = lead[:-delay] * 0.35
    echo[2 * delay:] += lead[:-2 * delay] * 0.15
    lead = reverb(lead + echo, 1.2, 0.3)
    hats = band(hats, 6000, 15000) * 2.6
    mono = pad + bass + drums + hats
    left = mono + lead * 0.9 + np.roll(pad, 220) * 0.15
    right = mono + np.roll(lead, 300) * 0.9 + np.roll(pad, 400) * 0.15
    return np.tanh(np.stack([left, right], axis=1) * 1.2) / 1.2


def sfx(total, durations):
    n = int(total * SR)
    out = np.zeros(n)
    t = 0.0
    for i, d in enumerate(durations):
        if i > 0:  # 들어올 때 「뽁」
            tp = np.arange(int(0.09 * SR)) / SR
            add(out, t + 0.02, 0.12 * np.sin(2 * np.pi * (700 + 900 * tp / 0.09) * tp) * np.exp(-tp * 40))
        if i + 1 < len(durations):  # 나갈 때 바람 소리
            m = int(FADE * SR)
            noise = lowpass(rng.standard_normal(m), 2500) - lowpass(rng.standard_normal(m), 300) * 0.3
            add(out, t + d - FADE, 0.10 * noise * np.sin(np.linspace(0, np.pi, m)))
        t += d
    return np.stack([out, out], axis=1)


def read_voice(path):
    with wave.open(str(path)) as w:
        if w.getframerate() != SR or w.getsampwidth() != 2:
            raise SystemExit(f"내레이션은 44.1kHz 16비트여야 한다: {path}")
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        if w.getnchannels() == 2:
            x = x.reshape(-1, 2).mean(axis=1)
    loud = np.where(np.abs(x) > 0.02)[0]  # 앞뒤 무음 자르기
    return x[loud[0]: loud[-1] + int(0.05 * SR)] if len(loud) else x


def main():
    name, out = sys.argv[1], sys.argv[2]
    voice_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    voices = [read_voice(voice_dir / f"{name}-{i}.wav") for i in range(1, 6)] if voice_dir else None
    durations = DEFAULT if not voices else [round(max(d, FADE + len(v) / SR + 0.7), 2) for d, v in zip(DEFAULT, voices)]
    total = sum(durations)
    n = int(total * SR)

    bed = music(total)[:n]
    duck = np.ones(n)
    narration = np.zeros(n)
    if voices:
        t = 0.0
        for d, v in zip(durations, voices):
            s = int((t + FADE) * SR)
            e = min(n, s + len(v))
            narration[s:e] += v[: e - s] * 0.9
            duck[max(0, s - int(0.15 * SR)): e + int(0.2 * SR)] = 0.25  # 목소리가 음악보다 약 10dB 크게(0.45는 5.6dB뿐 — 2026-11-03 실측)
            t += d
        duck = lowpass(duck, 8)  # 갑자기 바뀌지 않게
    mix = bed * duck[:, None] + sfx(total, durations)[:n] + narration[:, None]
    mix *= env(n, 0.3, 1.2)[:, None]
    mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))  # 최고점 -1 dBFS

    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())
    rms = 20 * np.log10(np.sqrt(np.mean(mix ** 2)))
    print(f"saved {out} ({total:.1f}s, RMS {rms:.1f} dBFS)")
    print(",".join(str(d) for d in durations))


if __name__ == "__main__":
    main()
