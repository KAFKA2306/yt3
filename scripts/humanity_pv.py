import difflib
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from bisect import bisect_left
from pathlib import Path

import yaml
from faster_whisper import WhisperModel
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((ROOT / "config/music/humanity.yaml").read_text())["pv"]
THEMES = {"lyricpv", "kinetic", "wa", "horror", "pop", "ballad"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def lyric_lines(lyrics: str) -> list[str]:
    return [line for line in lyrics.splitlines() if line.strip() and not line.startswith("[")]


def align(audio: Path, lines: list[str]) -> str:
    if not lines:
        raise ValueError("lyrics contain no display lines")

    def normalize(text: str) -> str:
        return "".join(character for character in text if character.isalnum())

    model = WhisperModel(CFG["whisper_model"], device="cuda", compute_type="float16")
    segments, _ = model.transcribe(
        str(audio),
        language="ja",
        condition_on_previous_text=False,
        initial_prompt="\n".join(lines),
        word_timestamps=True,
    )
    transcript: list[str] = []
    audio_times: list[float] = []
    audio_duration = 0.0
    for segment in segments:
        for word in segment.words or []:
            word_text = normalize(word.word)
            if not word_text or word.start is None or word.end is None:
                continue
            start, end = float(word.start), float(word.end)
            audio_duration = max(audio_duration, end)
            transcript.extend(word_text)
            audio_times.extend(
                start + (end - start) * (index / len(word_text))
                for index in range(len(word_text))
            )
    if not transcript:
        raise RuntimeError("Whisper returned no word-level timestamps")

    lyric_starts: list[int] = []
    lyric_parts: list[str] = []
    for line in lines:
        lyric_starts.append(sum(map(len, lyric_parts)))
        lyric_parts.append(normalize(line))
    lyrics = "".join(lyric_parts)
    if not lyrics:
        raise ValueError("lyrics contain no alignable characters")

    anchors: list[tuple[int, float]] = []
    matcher = difflib.SequenceMatcher(None, transcript, lyrics, autojunk=False)
    for block in matcher.get_matching_blocks():
        anchors.extend(
            (block.b + offset, audio_times[block.a + offset])
            for offset in range(block.size)
        )
    if not anchors:
        raise RuntimeError("Whisper transcript did not match the supplied lyrics")

    lyric_positions = [position for position, _ in anchors]
    anchor_times = [timestamp for _, timestamp in anchors]
    duration = audio_duration
    timestamps: list[float] = []
    for start, line in zip(lyric_starts, lines):
        end = start + len(normalize(line))
        index = bisect_left(lyric_positions, start)
        if index < len(anchors) and lyric_positions[index] < end:
            timestamp = anchor_times[index]
        elif index == 0:
            timestamp = anchor_times[0]
        elif index == len(anchors):
            timestamp = anchor_times[-1]
        else:
            left_position, right_position = lyric_positions[index - 1], lyric_positions[index]
            fraction = (start - left_position) / max(1, right_position - left_position)
            timestamp = anchor_times[index - 1] + fraction * (
                anchor_times[index] - anchor_times[index - 1]
            )
        timestamps.append(min(duration, max(0.0, timestamp)))

    for index in range(1, len(timestamps)):
        timestamps[index] = max(timestamps[index], timestamps[index - 1] + 0.03)
    if timestamps[-1] > duration:
        raise RuntimeError("lyric alignment exceeds the audio duration")

    def lrc_time(seconds: float) -> str:
        centiseconds = round(seconds * 100)
        minutes, remainder = divmod(centiseconds, 6000)
        whole_seconds, fraction = divmod(remainder, 100)
        return f"[{minutes:02d}:{whole_seconds:02d}.{fraction:02d}]"

    return "\n".join(
        f"{lrc_time(timestamp)}{line}" for timestamp, line in zip(timestamps, lines)
    ) + "\n"


def export(
    lrc: Path,
    audio: Path,
    visual: dict,
    raw: Path,
    project_output: Path,
) -> tuple[dict, float | None]:
    theme = visual["theme_id"]
    if not isinstance(theme, str) or theme not in THEMES:
        raise ValueError(f"unsupported JIZURA theme: {theme}")
    title = visual["title"]
    seed = visual["seed"]
    unify = visual["unify"]
    typeset = visual["typeset"]
    if not isinstance(title, str) or not title.strip():
        raise ValueError("JIZURA title is missing")
    if type(seed) is not int:
        raise ValueError("JIZURA seed must be an integer")
    if type(unify) is not bool or type(typeset) is not bool:
        raise ValueError("JIZURA unification and typesetting choices must be booleans")
    palette = visual["palette"]
    if any(
        not isinstance(palette.get(key), str)
        or not re.fullmatch(r"#[0-9a-fA-F]{6}", palette[key])
        for key in ("accent", "ghost_a", "ghost_b")
    ):
        raise ValueError("JIZURA palette must use six-digit hex colors")
    if not isinstance(visual["rationale"], str) or not visual["rationale"].strip():
        raise ValueError("JIZURA design rationale is missing")
    project = {
        "version": 1,
        "title": title,
        "artist": "人類観測所",
        "lyrics": "",
        "themeId": theme,
        "aspect": "16:9",
        "res": 1080,
        "fps": 24,
        "includeAudio": False,
        "seed": seed,
        "unify": unify,
        "typeset": typeset,
        "lang": "ja",
    }
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CFG["chrome"], headless=True, args=["--no-sandbox"])
        try:
            page = browser.new_page(accept_downloads=True)
            page.goto((ROOT / CFG["jizura_html"]).as_uri(), wait_until="load")
            with tempfile.TemporaryDirectory(prefix="humanity-jizura-") as temp_dir:
                project_input = Path(temp_dir) / "project.json"
                project_input.write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")
                page.set_input_files("#fileProject", str(project_input))
            page.set_input_files("#audioFile", str(audio))
            page.wait_for_function(
                "document.querySelector('#timeDur')?.textContent.trim() !== '00:00.00' "
                "&& !document.querySelector('#audioName')?.textContent.includes('解析中')",
                timeout=300_000,
            )
            page.set_input_files("#fileLrc", str(lrc))
            page.wait_for_function(
                "document.querySelectorAll('#lineList li').length > 0",
                timeout=30_000,
            )
            skip = page.locator(".tour-skip")
            if skip.is_visible():
                skip.click()
            page.click("#modeEasy")
            page.evaluate(
                """seed => {
                    if (!window.J || typeof window.J.rng !== 'function') {
                        throw new Error('JIZURA seeded random source is unavailable');
                    }
                    const original = Math.random;
                    Math.random = window.J.rng(seed);
                    try {
                        const button = document.querySelector('#btnOmakase');
                        if (!button) throw new Error('JIZURA Omakase button is unavailable');
                        button.click();
                    } finally {
                        Math.random = original;
                    }
                }""",
                seed,
            )
            page.wait_for_function(
                """seed => {
                    const saved = JSON.parse(localStorage.getItem('jizura.project.v1') || 'null');
                    return saved && saved.seed !== seed && saved.style && saved.mood;
                }""",
                arg=seed,
                timeout=30_000,
            )
            saved_project = page.evaluate("JSON.parse(localStorage.getItem('jizura.project.v1'))")
            if saved_project.get("themeId") != theme:
                raise RuntimeError("JIZURA did not keep the selected story theme")
            if saved_project.get("includeAudio") is not False:
                raise RuntimeError("JIZURA project must leave audio embedding off")
            palette_colors = {
                "enabled": False,
                "accentOn": True,
                "accent": palette["accent"].upper(),
                "ghostA": palette["ghost_a"].upper(),
                "ghostB": palette["ghost_b"].upper(),
            }
            saved_project["colors"] = {**saved_project.get("colors", {}), **palette_colors}
            with tempfile.TemporaryDirectory(prefix="humanity-jizura-palette-") as temp_dir:
                project_input = Path(temp_dir) / "project.json"
                project_input.write_text(
                    json.dumps(saved_project, ensure_ascii=False), encoding="utf-8"
                )
                page.set_input_files("#fileProject", str(project_input))
            page.wait_for_function(
                """colors => {
                    const saved = JSON.parse(localStorage.getItem('jizura.project.v1') || 'null');
                    return saved && saved.colors && saved.colors.accentOn === true
                        && saved.colors.accent === colors.accent
                        && saved.colors.ghostA === colors.ghostA
                        && saved.colors.ghostB === colors.ghostB;
                }""",
                arg=palette_colors,
                timeout=30_000,
            )
            saved_project = page.evaluate("JSON.parse(localStorage.getItem('jizura.project.v1'))")
            audio_status = page.locator("#audioName").text_content() or ""
            detected_bpm_match = re.search(r"約([0-9]+(?:\.[0-9]+)?)BPM", audio_status)
            detected_bpm = float(detected_bpm_match.group(1)) if detected_bpm_match else None
            with page.expect_download(timeout=CFG["export_timeout_ms"]) as download:
                page.click("#eMP4")
            download.value.save_as(str(raw))
        finally:
            browser.close()
    project_output.write_text(
        json.dumps(saved_project, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return saved_project, detected_bpm


def lrc_matches(lrc: Path, lines: list[str], audio_duration: float) -> bool:
    rows = lrc.read_text(encoding="utf-8").splitlines()
    if len(rows) != len(lines):
        return False
    previous = -1.0
    for row, lyric in zip(rows, lines):
        match = re.fullmatch(r"\[(\d+):(\d{2})\.(\d{2})\](.*)", row)
        if not match or match.group(4) != lyric:
            return False
        timestamp = int(match.group(1)) * 60 + int(match.group(2)) + int(match.group(3)) / 100
        if timestamp < previous or timestamp > audio_duration:
            return False
        previous = timestamp
    return True


def has_audio(file: Path) -> bool:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(file),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() == "audio"


def mux_video_audio(video_input: Path, audio: Path, output: Path) -> None:
    video_info = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_input),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    codec = video_info.stdout.strip()
    args = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(video_input),
        "-i",
        str(audio),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
    ]
    if codec == "h264":
        args.extend(["-c:v", "copy"])
    else:
        args.extend(
            ["-c:v", "libx264", "-crf", str(CFG["crf"]), "-pix_fmt", "yuv420p"]
        )
    args.extend(
        [
            "-c:a",
            "aac",
            "-b:a",
            CFG["audio_bitrate"],
            "-ar",
            "48000",
            "-ac",
            "2",
            "-shortest",
            "-movflags",
            "+faststart",
            str(output),
        ]
    )
    subprocess.run(args, check=True)
    if not has_audio(output):
        raise RuntimeError("the final video has no audio stream")


def main(audio: Path, lyrics: Path, visual_path: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    lrc = out / "song.lrc"
    raw = out / "jizura.mp4"
    video = out / "video.mp4"
    project_output = out / "jizura.project.json"
    visual = json.loads(visual_path.read_text(encoding="utf-8"))
    source_lyrics = lyric_lines(lyrics.read_text(encoding="utf-8"))
    detected_bpm = None
    reusable_render = video.exists() and project_output.exists() and lrc.exists() and not raw.exists()
    if reusable_render:
        saved_project = json.loads(project_output.read_text(encoding="utf-8"))
        duration = float(
            subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(audio),
                ],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        )
        colors = saved_project.get("colors", {})
        palette = visual["palette"]
        expected_colors = {
            "accent": palette["accent"].upper(),
            "ghostA": palette["ghost_a"].upper(),
            "ghostB": palette["ghost_b"].upper(),
        }
        reusable_render = (
            saved_project.get("title") == visual["title"]
            and saved_project.get("themeId") == visual["theme_id"]
            and saved_project.get("includeAudio") is False
            and all(colors.get(key) == color for key, color in expected_colors.items())
            and lrc_matches(lrc, source_lyrics, duration)
        )
        if reusable_render and not has_audio(video):
            muxed_video = out / "video.with-audio.mp4"
            mux_video_audio(video, audio, muxed_video)
            muxed_video.replace(video)
    if not reusable_render:
        lrc.write_text(align(audio, source_lyrics), encoding="utf-8")
        saved_project, detected_bpm = export(lrc, audio, visual, raw, project_output)
        mux_video_audio(raw, audio, video)
        raw.unlink()
    (out / "pv.json").write_text(
        json.dumps(
            {
                "tool": "jizura",
                "jizura_version": (ROOT / CFG["jizura_version"]).read_text().strip(),
                "jizura_sha256": sha256(ROOT / CFG["jizura_html"]),
                "project_sha256": sha256(project_output),
                "visual_plan_sha256": sha256(visual_path),
                "audio_sha256": sha256(audio),
                "lyrics_sha256": sha256(lyrics),
                "theme_id": saved_project.get("themeId"),
                "style": saved_project.get("style"),
                "mood": saved_project.get("mood"),
                "detected_bpm": detected_bpm,
                "beat_sync": detected_bpm is not None,
                "seed": saved_project.get("seed"),
                "unify": saved_project.get("unify"),
                "typeset": saved_project.get("typeset"),
                "palette": {
                    "accent": saved_project.get("colors", {}).get("accent"),
                    "ghost_a": saved_project.get("colors", {}).get("ghostA"),
                    "ghost_b": saved_project.get("colors", {}).get("ghostB"),
                },
                "rationale": visual["rationale"],
                "whisper_model": CFG["whisper_model"],
                "lrc_sha256": sha256(lrc),
                "sha256": sha256(video),
            }
        )
    )


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("usage: humanity_pv.py AUDIO LYRICS JIZURA_PLAN OUTPUT_DIR")
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
