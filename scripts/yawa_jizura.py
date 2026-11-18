from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import subprocess
import tempfile
import wave
from fractions import Fraction
from pathlib import Path
from typing import Any

import yaml
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
THEMES = {"lyricpv", "kinetic", "wa", "horror", "pop", "ballad"}
ASPECTS = {
    Fraction(16, 9): "16:9",
    Fraction(9, 16): "9:16",
    Fraction(4, 3): "4:3",
    Fraction(3, 4): "3:4",
    Fraction(1, 1): "1:1",
    Fraction(4, 5): "4:5",
    Fraction(7, 3): "21:9",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as audio:
        if audio.getframerate() <= 0:
            raise ValueError(f"invalid WAV sample rate: {path}")
        return audio.getnframes() / audio.getframerate()


def timestamp(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    whole_seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{whole_seconds:02},{milliseconds:03}"


def performances(draft: dict[str, Any]) -> list[dict[str, Any]]:
    return list(draft.get("performances", [])) + [
        item for chapter in draft.get("chapters", []) for item in chapter.get("performances", [])
    ]


def make_srt(draft: dict[str, Any], tts_dir: Path, output: Path) -> tuple[int, float]:
    rows = performances(draft)
    if not rows:
        raise ValueError("script has no performances for JIZURA subtitles")

    blocks: list[str] = []
    offset = 0.0
    for index, item in enumerate(rows, 1):
        audio_path = tts_dir / f"performance_{index:05}.wav"
        if not audio_path.is_file():
            raise FileNotFoundError(f"performance audio is missing: {audio_path}")
        duration = wav_duration(audio_path)
        text = " ".join(str(item["text"]).split()).replace("-->", "→")
        if not text:
            raise ValueError(f"performance {index} has no subtitle text")
        blocks.append(f"{index}\n{timestamp(offset)} --> {timestamp(offset + duration)}\n{text}")
        offset += duration

        pause_path = tts_dir / f"pause_{index:05}.wav"
        pause_seconds = float(item.get("pause_after_seconds", 0) or 0)
        if pause_seconds > 0:
            if not pause_path.is_file():
                raise FileNotFoundError(f"performance pause is missing: {pause_path}")
            offset += wav_duration(pause_path)

    output.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    return len(blocks), offset


def probe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    return {
        "seconds": float(data["format"]["duration"]),
        "width": video.get("width") if video else None,
        "height": video.get("height") if video else None,
        "audio": any(stream.get("codec_type") == "audio" for stream in streams),
        "video": video is not None,
    }


def resolve_aspect(width: int, height: int) -> tuple[str, int, int, int]:
    aspect = Fraction(width, height)
    name = ASPECTS.get(aspect)
    if not name:
        raise ValueError(f"JIZURA does not support video aspect {width}:{height}")
    resolution = min(width, height)
    if resolution not in {720, 1080, 1440, 2160}:
        raise ValueError(f"JIZURA does not support {resolution}px short-side resolution")
    ratio = Fraction(name.split(":")[0]) / Fraction(name.split(":")[1])
    if ratio >= 1:
        return name, resolution, round(resolution * ratio), resolution
    return name, resolution, resolution, round(resolution / ratio)


def build_project(
    draft: dict[str, Any],
    runtime: dict[str, Any],
    project_override: Path | None,
) -> dict[str, Any]:
    production = draft.get("production", {})
    video = dict(runtime["video"])
    video.update(production.get("video", {}))
    width, height = int(video["width"]), int(video["height"])
    aspect, resolution, expected_width, expected_height = resolve_aspect(width, height)
    theme = production.get("jizura_theme")
    project: dict[str, Any] = {
        "version": 1,
        "title": draft["title"],
        "artist": "夜話アーカイブ",
        "lyrics": "",
        "themeId": theme,
        "aspect": aspect,
        "res": resolution,
        "fps": int(video["fps"]),
        "includeAudio": False,
        "seed": random.SystemRandom().randrange(1, 2**31),
    }
    if project_override:
        project.update(json.loads(project_override.read_text(encoding="utf-8-sig")))
    project["title"] = draft["title"]
    project["artist"] = "夜話アーカイブ"
    project["lyrics"] = ""
    project["themeId"] = project.get("themeId") or theme
    project["aspect"] = aspect
    project["res"] = resolution
    project["fps"] = int(video["fps"])
    project["includeAudio"] = False

    if project["themeId"] is not None and project["themeId"] not in THEMES:
        raise ValueError(f"unknown JIZURA theme: {project['themeId']}")
    return project | {
        "_expected_width": expected_width,
        "_expected_height": expected_height,
        "_randomize": project_override is None,
    }


def export_jizura(
    html: Path,
    chrome: str,
    timeout_ms: int,
    audio: Path,
    subtitles: Path,
    project_file: Path,
    raw_video: Path,
    randomize: bool,
) -> dict[str, Any]:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=chrome,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = browser.new_page(accept_downloads=True)
            page.goto(html.as_uri(), wait_until="load")
            skip = page.locator(".tour-skip")
            if skip.is_visible():
                skip.click()
            page.set_input_files("#fileProject", str(project_file))
            page.set_input_files("#audioFile", str(audio))
            page.wait_for_function(
                "document.querySelector('#timeDur')?.textContent.trim() !== '00:00.00' "
                "&& !document.querySelector('#audioName')?.textContent.includes('解析中')",
                timeout=300_000,
            )
            page.set_input_files("#fileLrc", str(subtitles))
            page.wait_for_function(
                "document.querySelectorAll('#lineList li').length > 0",
                timeout=30_000,
            )
            page.click("#modeEasy")
            if randomize:
                page.keyboard.press("r")
                page.wait_for_timeout(250)
            saved_project = page.evaluate("JSON.parse(localStorage.getItem('jizura.project.v1'))")
            if saved_project.get("includeAudio") is not False:
                raise RuntimeError("JIZURA project must leave audio embedding off")
            project_file.write_text(
                json.dumps(saved_project, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            with page.expect_download(timeout=timeout_ms) as download:
                page.click("#eMP4")
            download.value.save_as(str(raw_video))
            return saved_project
        finally:
            browser.close()


def render(args: argparse.Namespace) -> dict[str, Any]:
    audio = args.audio.resolve()
    script = args.script.resolve()
    tts_dir = args.tts_dir.resolve()
    output = args.output.resolve()
    if output.exists():
        raise FileExistsError(f"refusing to replace existing video: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    runtime_path = ROOT / "config/yawa/runtime.yaml"
    runtime = yaml.safe_load(runtime_path.read_text(encoding="utf-8"))
    draft = json.loads(script.read_text(encoding="utf-8"))
    jizura = runtime["jizura"]
    html = ROOT / jizura["html"]
    version_file = ROOT / jizura["version_file"]
    version = version_file.read_text(encoding="utf-8").strip()
    if not html.is_file() or not version:
        raise FileNotFoundError("vendored JIZURA or its version file is missing")
    if f"v{version}" not in html.read_text(encoding="utf-8", errors="replace"):
        raise RuntimeError("JIZURA index.html and VERSION do not match")
    if not audio.is_file() or not script.is_file() or not tts_dir.is_dir():
        raise FileNotFoundError("JIZURA input audio, script, or TTS directory is missing")

    audio_info = probe(audio)
    if not audio_info["audio"] or audio_info["seconds"] <= 0:
        raise ValueError("JIZURA input must be a playable audio file")
    export_timeout_ms = max(
        int(jizura["export_timeout_ms"]),
        int(audio_info["seconds"] * 10_000),
    )
    output_width = int(draft.get("production", {}).get("video", {}).get("width", runtime["video"]["width"]))
    output_height = int(draft.get("production", {}).get("video", {}).get("height", runtime["video"]["height"]))
    project = build_project(draft, runtime, args.project)
    expected_width = project.pop("_expected_width")
    expected_height = project.pop("_expected_height")
    randomize = project.pop("_randomize")
    if (output_width, output_height) != (expected_width, expected_height):
        raise ValueError(
            f"JIZURA output is {expected_width}x{expected_height}; requested {output_width}x{output_height}"
        )

    with tempfile.TemporaryDirectory(prefix=".yawa-jizura-", dir=output.parent) as temp_dir:
        temp = Path(temp_dir)
        subtitles = temp / "dialogue.srt"
        project_file = temp / "project.json"
        raw_video = temp / "jizura.mp4"
        raw_final = temp / "final.mp4"
        subtitle_count, subtitle_duration = make_srt(draft, tts_dir, subtitles)
        difference = abs(subtitle_duration - audio_info["seconds"])
        if difference > max(0.1, 2 / float(runtime["video"]["fps"])):
            raise ValueError(
                f"dialogue timings span {subtitle_duration:.3f}s, but final audio is {audio_info['seconds']:.3f}s"
            )
        project_file.write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")
        saved_project = export_jizura(
            html,
            jizura["chrome"],
            export_timeout_ms,
            audio,
            subtitles,
            project_file,
            raw_video,
            randomize,
        )

        raw_info = probe(raw_video)
        if raw_info["audio"]:
            raise RuntimeError("JIZURA unexpectedly embedded audio in its visual export")
        if not raw_info["video"] or (raw_info["width"], raw_info["height"]) != (
            expected_width,
            expected_height,
        ):
            raise RuntimeError("JIZURA export dimensions do not match the selected project")
        if abs(raw_info["seconds"] - audio_info["seconds"]) > max(0.1, 2 / float(runtime["video"]["fps"])):
            raise RuntimeError(f"JIZURA export is {raw_info['seconds']:.3f}s; audio is {audio_info['seconds']:.3f}s")

        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(raw_video),
                "-i",
                str(audio),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                runtime["video"]["audio_bitrate"],
                "-t",
                f"{audio_info['seconds']:.6f}",
                "-movflags",
                "+faststart",
                str(raw_final),
            ],
            check=True,
            capture_output=True,
        )
        final_info = probe(raw_final)
        if not final_info["audio"] or not final_info["video"]:
            raise RuntimeError("final JIZURA video must contain audio and video")
        if (final_info["width"], final_info["height"]) != (expected_width, expected_height):
            raise RuntimeError("final JIZURA video dimensions changed during mux")
        if abs(final_info["seconds"] - audio_info["seconds"]) > max(0.1, 2 / float(runtime["video"]["fps"])):
            raise RuntimeError("final JIZURA video duration differs from the source audio")
        shutil.move(str(raw_final), str(output))
        project_output = output.with_name(f"{output.stem}.jizura.project.json")
        project_output.write_text(
            json.dumps(saved_project, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        receipt = {
            "tool": "JIZURA",
            "jizura_version": version,
            "jizura_sha256": sha256(html),
            "source_audio_sha256": sha256(audio),
            "subtitle_sha256": sha256(subtitles),
            "project_sha256": sha256(project_output),
            "raw_video_sha256": sha256(raw_video),
            "video_sha256": sha256(output),
            "subtitle_count": subtitle_count,
            "subtitle_timing_seconds": round(subtitle_duration, 3),
            "video_seconds": round(final_info["seconds"], 3),
            "width": final_info["width"],
            "height": final_info["height"],
            "fps": int(runtime["video"]["fps"]),
            "export_timeout_ms": export_timeout_ms,
            "theme": saved_project.get("themeId"),
            "style": saved_project.get("style"),
            "mood": saved_project.get("mood"),
        }
        receipt_file = output.with_name(f"{output.stem}.jizura.json")
        receipt_file.write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a Yawa video through JIZURA")
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--tts-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--project", type=Path)
    args = parser.parse_args()
    print(json.dumps(render(args), ensure_ascii=False))


if __name__ == "__main__":
    main()
