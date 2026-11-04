import difflib
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import yaml
from faster_whisper import WhisperModel
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((ROOT / "config/music/humanity.yaml").read_text())["pv"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def lyric_lines(lyrics: str) -> list[str]:
    return [line for line in lyrics.splitlines() if line.strip() and not line.startswith("[")]


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def assign(texts: list[str], lines: list[str]) -> list[int]:
    n, m = len(texts), len(lines)
    assert n >= m, f"{n} segments for {m} lyric lines"
    sim = [[similarity(t, line) for t in texts] for line in lines]
    best = [[-1.0] * (n + 1) for _ in range(m + 1)]
    best[0] = [0.0] * (n + 1)
    for i in range(1, m + 1):
        for j in range(i, n + 1):
            best[i][j] = max(best[i][j - 1], best[i - 1][j - 1] + sim[i - 1][j - 1])
    picked, j = [], n
    for i in range(m, 0, -1):
        while best[i][j] == best[i][j - 1]:
            j -= 1
        picked.append(j - 1)
        j -= 1
    return picked[::-1]


def align(audio: Path, lines: list[str]) -> str:
    model = WhisperModel(CFG["whisper_model"], device="cuda", compute_type="float16")
    segments, _ = model.transcribe(
        str(audio),
        language="ja",
        condition_on_previous_text=False,
        initial_prompt="\n".join(lines),
    )
    found = list(segments)
    starts = [found[i].start for i in assign([s.text for s in found], lines)]
    return "\n".join(f"[{int(t // 60):02d}:{t % 60:05.2f}]{line}" for t, line in zip(starts, lines)) + "\n"


def export(lrc: Path, audio: Path, raw: Path) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CFG["chrome"], headless=True, args=["--no-sandbox"])
        page = browser.new_page(accept_downloads=True)
        page.goto((ROOT / CFG["jizura_html"]).as_uri())
        page.fill("#lyrics", lrc.read_text())
        page.set_input_files("#audioFile", str(audio))
        page.wait_for_timeout(CFG["load_ms"])
        page.click("text=スキップ")
        page.click("#modeEasy")
        page.keyboard.press("r")
        with page.expect_download(timeout=CFG["export_timeout_ms"]) as download:
            page.click("#eMP4")
        download.value.save_as(str(raw))
        browser.close()


def main(audio: Path, lyrics: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    lrc = out / "song.lrc"
    raw = out / "jizura.mp4"
    video = out / "video.mp4"
    lrc.write_text(align(audio, lyric_lines(lyrics.read_text())))
    export(lrc, audio, raw)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(raw),
            "-c:v",
            "libx264",
            "-crf",
            str(CFG["crf"]),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            CFG["audio_bitrate"],
            "-movflags",
            "+faststart",
            str(video),
        ],
        check=True,
    )
    raw.unlink()
    (out / "pv.json").write_text(
        json.dumps(
            {
                "tool": "jizura",
                "jizura_version": (ROOT / CFG["jizura_version"]).read_text().strip(),
                "jizura_sha256": sha256(ROOT / CFG["jizura_html"]),
                "whisper_model": CFG["whisper_model"],
                "lrc_sha256": sha256(lrc),
                "sha256": sha256(video),
            }
        )
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
