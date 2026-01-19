import subprocess

from src.asset import AssetStore
from src.config import load_config


class VideoAgent:
    def __init__(self, store: AssetStore):
        self.store = store
        cfg = load_config()
        video_cfg = cfg.get("steps", {}).get("video", {})
        self.resolution = video_cfg.get("resolution", "1920x1080")
        self.fps = video_cfg.get("fps", 25)
        self.codec = video_cfg.get("codec", "libx264")

    def run(self, audio_paths: list[str]) -> str:
        self.store.log_input("video", {"audio_paths": audio_paths})

        audio_dir = self.store.audio_dir()
        video_dir = self.store.video_dir()
        audio_path = audio_dir / "full_audio.wav"
        output_path = video_dir / "video.mp4"

        width, height = self.resolution.split("x")

        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s={width}x{height}:r={self.fps}",
            "-i",
            str(audio_path),
            "-shortest",
            "-c:v",
            self.codec,
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(output_path),
        ]

        subprocess.run(cmd, check=True)

        self.store.log_output("video", {"path": str(output_path), "status": "completed"})

        return str(output_path)
