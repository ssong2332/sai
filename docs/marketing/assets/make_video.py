"""장면 PNG(video.html 렌더)를 이어 붙여 세로 mp4를 만든다 (2026-11-03).

쓰는 법(저장소 루트): python -I docs/marketing/assets/make_video.py <장면 폴더> <v1|v2> <출력.mp4>
효과: 장면마다 1.04배 → 1배로 살짝 당겨지며 등장(0.6초), 장면 사이 흰 화면을 거치는 전환(나갈 때·들어올 때 각 0.35초). 소리 없음 — 음악은 앱에서 얹는다.
필요: numpy · opencv-python · imageio-ffmpeg(H.264 인코더가 들어 있다).
"""
import sys
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np

FPS = 30
DURATIONS = [3.2, 2.8, 4.4, 3.6, 3.2]  # 장면 1~5, 초
FADE = 0.35
POP = 0.6
W, H = 1080, 1920
WHITE = np.full((H, W, 3), 255, dtype=np.uint8)


def load(path):
    # 🔴 cv2.imread는 Windows에서 한글 경로를 못 연다(2026-11-03 실측) — 바이트로 읽어 디코드
    img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None or img.shape[:2] != (H, W):
        raise SystemExit(f"장면 크기가 1080×1920이 아니다: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def zoomed(img, t):
    p = min(t / POP, 1.0)
    scale = 1 + 0.04 * (1 - (1 - (1 - p) ** 3))  # ease-out
    if scale <= 1.0001:
        return img
    big = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    y, x = (big.shape[0] - H) // 2, (big.shape[1] - W) // 2
    return big[y:y + H, x:x + W]


def main():
    folder, name, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    scenes = [load(folder / f"{name}-{i}.png") for i in range(1, 6)]
    writer = imageio_ffmpeg.write_frames(out, (W, H), fps=FPS, codec="libx264", pix_fmt_out="yuv420p",
                                         quality=None, bitrate="6M", macro_block_size=8)
    writer.send(None)
    frames = 0
    for i, (img, dur) in enumerate(zip(scenes, DURATIONS)):
        n = int(dur * FPS)
        for f in range(n):
            t = f / FPS
            frame = zoomed(img, t)
            # 흰 화면을 거쳐 전환 — 교차 전환은 크기가 다른 두 장면이 겹쳐 로고·글자가 이중으로 보였다(2026-11-03 프레임 확인)
            if i + 1 < len(scenes) and t > dur - FADE:
                a = (t - (dur - FADE)) / FADE
                frame = cv2.addWeighted(frame, 1 - a, WHITE, a, 0)
            elif i > 0 and t < FADE:
                a = t / FADE
                frame = cv2.addWeighted(WHITE, 1 - a, frame, a, 0)
            writer.send(np.ascontiguousarray(frame))
            frames += 1
    writer.close()
    print(f"saved {out} ({frames} frames, {frames / FPS:.1f}s)")


if __name__ == "__main__":
    main()
