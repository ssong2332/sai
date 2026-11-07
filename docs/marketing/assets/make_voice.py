"""릴스 내레이션 — Microsoft 신경망 음성(edge-tts) ko-KR-SunHiNeural (2026-11-03 사용자 지적 「기계음」으로 Heami에서 바꿈).

쓰는 법(저장소 루트): python -I docs/marketing/assets/make_voice.py <출력 폴더>
→ <폴더>/v1-1.wav … v2-5.wav (44.1kHz 16비트 모노 — make_audio.py가 읽는 형식).
🔴 문장을 Microsoft 온라인 음성 서비스로 보낸다 — 공개 홍보 문장만 넣는다(개인정보·실명 금지).
필요: edge-tts · imageio-ffmpeg.
"""
import asyncio
import subprocess
import sys
from pathlib import Path

import edge_tts
import imageio_ffmpeg

VOICE = "ko-KR-SunHiNeural"
RATE = "+6%"
LINES = {  # LaunchPosts.md 5-5와 같다
    "v1-1": "해외 동료가 이렇게 답했어요. 좋다는 걸까요?",
    "v1-2": "직역하면, 다음 분기에 다시 논의해 봅시다.",
    "v1-3": "사이는 이걸, 지금은 진행하지 않겠다는 완곡한 보류 신호로 읽었어요.",
    "v1-4": "받은 메시지를 선택하고, 아이콘만 누르면 돼요.",
    "v1-5": "크롬 확장, 사이. 지금은 무료예요.",
    "v2-1": "빨리 해 주세요. 영어로는 어떻게 보낼까요?",
    "v2-2": "사이가 상대 언어로 다듬고, 긴급도까지 판정해요.",
    "v2-3": "상대에게 어떻게 읽히는지, 역번역으로 보여 줘요.",
    "v2-4": "무엇을 왜 바꿨는지도 알려 줘요.",
    "v2-5": "보내기 전에, 한 번 더. 크롬 확장, 사이.",
}


async def main(folder: Path):
    folder.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for key, text in LINES.items():
        mp3 = folder / f"{key}.mp3"
        await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(mp3))
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(mp3),
                        "-ar", "44100", "-ac", "1", "-sample_fmt", "s16", str(folder / f"{key}.wav")], check=True)
        mp3.unlink()
        print("saved", key)


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
