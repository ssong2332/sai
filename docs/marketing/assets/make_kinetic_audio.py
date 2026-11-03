"""키네틱 홍보 영상(kinetic.html) 소리 — 컷마다 타격음, 장면 전환 바람 소리, 타이핑 소리, 끝 장 직전 상승음 (2026-11-03).

쓰는 법(저장소 루트): python -I docs/marketing/assets/make_kinetic_audio.py <출력.wav> [큐.json]
큐 파일(없으면 아래 kinetic.html 값): {"total":초, "bpm":n, "hits":[초…], "cuts":[초…], "typing":[시작,끝,글자수] 또는 null, "riser":[시작,길이] 또는 null, "final":초 또는 null, "music":0~1}
음악: make_audio.py의 합성기를 100bpm으로(한 박 0.6초 — kinetic.html 컷과 같은 박자). 모두 직접 합성 — 저작권 없음.
"""
import importlib.util
import sys
import wave
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("ma", Path(__file__).with_name("make_audio.py"))
ma = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ma)
ma.BPM = 100
ma.BEAT = 60 / ma.BPM
SR = ma.SR
TOTAL = 15.0
# kinetic.html 컷·단어 등장 시각(초) — 바꾸면 같이 바꾼다
HITS = [0.0, 0.3, 1.2, 2.4, 2.8, 3.2, 4.5, 4.6, 5.4, 6.3, 7.2, 7.65, 7.8, 8.7, 9.6, 9.9, 10.2, 10.8, 11.1, 11.4, 12.0, 12.3, 12.6, 13.5]
SCENE_CUTS = [1.2, 2.4, 3.6, 5.4, 7.2, 8.4, 9.6, 10.8, 12.0, 12.9]
TYPING = (3.65, 4.4, 15)  # 시작, 끝, 글자 수
rng = np.random.default_rng(11)


def hit(strength=1.0):
    t = np.arange(int(0.5 * SR)) / SR
    boom = np.sin(2 * np.pi * (40 + 90 * np.exp(-t * 25)) * t) * np.exp(-t * 7)
    snap = ma.band(rng.standard_normal(len(t)), 1500, 8000) * np.exp(-t * 45)
    return (boom * 0.7 + snap * 0.35) * strength


def whoosh(length=0.3):
    n = int(length * SR)
    x = ma.band(rng.standard_normal(n), 400, 6000) * np.sin(np.linspace(0, np.pi, n)) ** 2
    return x * 0.35


def click():
    t = np.arange(int(0.03 * SR)) / SR
    return ma.band(rng.standard_normal(len(t)), 2000, 9000) * np.exp(-t * 200) * 0.25


def riser(length):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = 200 * (8 ** (t / length))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.15
    noise = ma.band(rng.standard_normal(n), 2000, 12000) * 0.2
    return (tone + noise) * (t / length) ** 2


def chord_hit():
    t = np.arange(int(2.0 * SR)) / SR
    notes = [53, 60, 65, 69, 72]  # F add9 계열 — 끝 장의 밝은 마무리
    x = sum(np.sin(2 * np.pi * ma.midi(m) * t) + 0.3 * np.sin(4 * np.pi * ma.midi(m) * t) for m in notes)
    return ma.reverb(x * np.exp(-t * 1.8) * 0.12, 1.8, 0.4)


def main():
    global TOTAL, HITS, SCENE_CUTS, TYPING
    out = sys.argv[1]
    riser_at, final_at, music_gain = (12.3, 0.6), 12.9, 0.55
    if len(sys.argv) > 2:
        import json
        cue = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        TOTAL, HITS, SCENE_CUTS = cue["total"], cue["hits"], cue["cuts"]
        TYPING, riser_at, final_at = cue.get("typing"), cue.get("riser"), cue.get("final")
        music_gain = cue.get("music", 0.55)
        ma.BPM = cue.get("bpm", 100)
        ma.BEAT = 60 / ma.BPM
    n = int(TOTAL * SR)
    bed = ma.music(TOTAL)[:n] * music_gain
    fx = np.zeros(n)
    for h in HITS:
        ma.add(fx, h, hit(0.8))
    for c in SCENE_CUTS:
        ma.add(fx, c - 0.18, whoosh(0.3))
    if TYPING:
        a, b, k = TYPING
        for i in range(k):
            ma.add(fx, a + (b - a) * i / k + rng.uniform(-0.01, 0.01), click())
    if riser_at:
        ma.add(fx, riser_at[0], riser(riser_at[1]))
    if final_at is not None:
        ma.add(fx, final_at, hit(1.2))
        ma.add(fx, final_at, chord_hit())
    fx = ma.reverb(fx, 0.6, 0.15)
    mix = bed + fx[:, None]
    mix *= ma.env(n, 0.02, 1.0)[:, None]
    mix = np.tanh(mix * 1.4) / 1.4
    mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())
    print(f"saved {out} ({TOTAL}s, RMS {20 * np.log10(np.sqrt(np.mean(mix ** 2))):.1f} dBFS)")


if __name__ == "__main__":
    main()
