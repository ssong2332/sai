"""릴스 소리 만들기 — 배경음악·효과음을 직접 합성하고(저작권 없음), 원하면 내레이션을 얹는다 (2026-11-03).

쓰는 법(저장소 루트):
  python -I docs/marketing/assets/make_audio.py <v1|v2> <출력.wav> [내레이션 폴더]
  → 마지막 줄에 장면 길이(쉼표 목록)를 찍는다. 그 값을 make_video.py 네 번째 인자로 넘겨 영상 길이를 맞춘다.
내레이션 폴더에는 <v1|v2>-1.wav … -5.wav (Windows 「Microsoft Heami」 음성, README 명령) — 없으면 음악·효과음만.

음악: 96bpm, Fmaj7 → Em7 → Dm7 → Cmaj7 반복. 패드 + 베이스 + 부드러운 킥 + 하이햇 + 아르페지오.
효과음: 장면이 들어올 때 짧은 「뽁」, 나갈 때 바람 소리. 내레이션이 나오는 동안 음악을 45%로 낮춘다.
필요: numpy만.
"""
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
DEFAULT = [3.2, 2.8, 4.4, 3.6, 3.2]  # make_video.py DURATIONS와 같다
FADE = 0.35
BPM = 96
BEAT = 60 / BPM
rng = np.random.default_rng(7)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]  # Fmaj7 Em7 Dm7 Cmaj7
ROOTS = [41, 40, 38, 36]


def env(n, attack, release):
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # 한 극 필터 — 길이가 짧아 충분히 빠르다
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def add(buf, start, sig):
    s = int(start * SR)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(sig))
    buf[s:e] += sig[: e - s]


def music(total):
    n = int(total * SR)
    pad_l, pad_r, beat = np.zeros(n), np.zeros(n), np.zeros(n)
    bar = BEAT * 4
    t_bar = np.arange(int(bar * SR)) / SR
    for b in range(int(total / bar) + 1):
        chord, root = CHORDS[b % 4], ROOTS[b % 4]
        e = env(len(t_bar), 0.25, 0.4)
        l = sum(np.sin(2 * np.pi * midi(m) * t_bar) + 0.3 * np.sin(4 * np.pi * midi(m) * t_bar) for m in chord)
        r = sum(np.sin(2 * np.pi * midi(m) * 1.003 * t_bar) + 0.3 * np.sin(4 * np.pi * midi(m) * 1.003 * t_bar) for m in chord)
        add(pad_l, b * bar, 0.05 * l * e)
        add(pad_r, b * bar, 0.05 * r * e)
        for k in range(4):  # 베이스 · 킥 · 하이햇 · 아르페지오
            t0 = b * bar + k * BEAT
            tb = np.arange(int(BEAT * SR)) / SR
            if k in (0, 2):
                add(beat, t0, 0.16 * np.sin(2 * np.pi * midi(root) * tb) * np.exp(-tb * 3))
            tk = np.arange(int(0.18 * SR)) / SR
            add(beat, t0, 0.22 * np.sin(2 * np.pi * (45 + 75 * np.exp(-tk * 30)) * tk) * np.exp(-tk * 18))
            th = np.arange(int(0.03 * SR)) / SR
            hat = np.diff(rng.standard_normal(len(th) + 1)) * np.exp(-th * 120)
            add(beat, t0 + BEAT / 2, 0.025 * hat)
            for j in range(2):
                note = chord[(k * 2 + j) % 4] + 12
                tp = np.arange(int(0.5 * SR)) / SR
                add(beat, t0 + j * BEAT / 2, 0.035 * np.sin(2 * np.pi * midi(note) * tp) * np.exp(-tp * 7))
    pad_l, pad_r = lowpass(pad_l, 1800), lowpass(pad_r, 1800)
    return np.stack([pad_l + beat, pad_r + beat], axis=1)


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
            duck[max(0, s - int(0.15 * SR)): e + int(0.2 * SR)] = 0.45
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
