"""Render Byosan's visual master through the pinned local JIZURA app."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
JIZURA_HTML = ROOT / "vendor" / "jizura" / "index.html"
JIZURA_VERSION = ROOT / "vendor" / "jizura" / "VERSION"
PALETTE = {
    "enabled": True,
    "accentOn": True,
    "accent": "#7BA7E1",
    "ghostA": "#8FA1B3",
    "ghostB": "#B8A7E6",
}
PIVOT_SCHEME = {
    "bg": "#C9DDF4",
    "fg": "#1B2350",
    "sub": "#4D5270",
    "accent": "#7BA7E1",
    "accent2": "#B8A7E6",
    "ink": "#1B2350",
    "dim": "#B7CDE8",
    "ghostA": "#7BA7E1",
    "ghostB": "#B8A7E6",
    "paper": True,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def lrc_timestamp(seconds: float) -> str:
    centiseconds = round(max(0.0, seconds) * 100)
    minutes, remainder = divmod(centiseconds, 6000)
    whole_seconds, fraction = divmod(remainder, 100)
    return f"[{minutes:02d}:{whole_seconds:02d}.{fraction:02d}]"


def cue_text(segment: dict, pivot: bool) -> str:
    text = " ".join(str(segment.get("cue", "")).split()).strip() or "秒算マネー"
    return f"{text}!" if pivot else text


def write_lrc(timeline: dict, output: Path) -> None:
    segments = timeline.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ValueError("Byosan JIZURA timeline has no timed segments")
    pivot_index = timeline.get("pivot_index")
    if not isinstance(pivot_index, int) or not 0 <= pivot_index < len(segments):
        raise ValueError("Byosan JIZURA timeline has an invalid pivot index")
    rows = []
    previous = -0.01
    for index, segment in enumerate(segments):
        start = float(segment["start"])
        if start < previous:
            raise ValueError("Byosan JIZURA cue times are not ordered")
        previous = start
        rows.append(f"{lrc_timestamp(start)}{cue_text(segment, index == pivot_index)}")
    output.write_text("\n".join(rows) + "\n", encoding="utf-8")


def import_project(page, project: dict, prefix: str) -> None:
    with tempfile.TemporaryDirectory(prefix=prefix) as directory:
        project_path = Path(directory) / "project.json"
        project_path.write_text(
            json.dumps(project, ensure_ascii=False), encoding="utf-8"
        )
        page.set_input_files("#fileProject", str(project_path))


def render(audio: Path, timeline_path: Path, output: Path) -> None:
    started = time.monotonic()
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    seed = timeline.get("seed")
    if type(seed) is not int or seed < 0:
        raise ValueError("Byosan JIZURA seed must be a nonnegative integer")
    if not JIZURA_HTML.is_file() or not JIZURA_VERSION.is_file():
        raise FileNotFoundError("Pinned local JIZURA HTML or VERSION is missing")
    output.parent.mkdir(parents=True, exist_ok=True)
    lrc = output.with_suffix(".lrc")
    project_output = output.with_suffix(".jizura.project.json")
    record_output = output.with_suffix(".jizura.json")
    write_lrc(timeline, lrc)
    project = {
        "version": 1,
        "timingOrder": 2,
        "themeId": "lyricpv",
        "title": str(
            timeline.get("visual_title") or timeline.get("title", "秒算マネー")
        ),
        "artist": "秒算マネー",
        "lyrics": "",
        "style": "paper",
        "mood": None,
        "extra": False,
        "wa": False,
        "kinetic": True,
        "typo": True,
        "lang": "ja",
        "keyBg": "off",
        "unify": False,
        "typeset": True,
        "seed": seed,
        "aspect": "16:9",
        "res": 1080,
        "fps": 24,
        "includeAudio": False,
        "colors": PALETTE,
        "timing": {"bpm": 0, "offset": 0.4, "snap": False, "tail": 0.9},
        "overrides": {},
    }
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            headless=True,
            args=["--no-sandbox"],
        )
        try:
            page = browser.new_page(accept_downloads=True)
            page.goto(JIZURA_HTML.as_uri(), wait_until="load")
            page.evaluate(
                """palette => {
                    const schemes = window.J?.STYLES?.paper?.schemes;
                    if (!Array.isArray(schemes) || !schemes[1])
                        throw new Error('JIZURA paper pivot scheme is unavailable');
                    schemes[1] = {...schemes[1], ...palette};
                }""",
                PIVOT_SCHEME,
            )
            import_project(page, project, "byosan-jizura-project-")
            page.set_input_files("#audioFile", str(audio))
            page.wait_for_function(
                "document.querySelector('#timeDur')?.textContent.trim() !== '00:00.00' "
                "&& !document.querySelector('#audioName')?.textContent.includes('解析中')",
                timeout=300_000,
            )
            page.set_input_files("#fileLrc", str(lrc))
            page.wait_for_function(
                "document.querySelectorAll('#lineList li').length > 0", timeout=30_000
            )
            tour_skip = page.locator(".tour-skip")
            if tour_skip.is_visible():
                tour_skip.click()
            page.click("#modeEasy")
            page.evaluate(
                """seed => {
                    if (!window.J || typeof window.J.rng !== 'function')
                        throw new Error('JIZURA seeded random source is unavailable');
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
            saved_project = page.evaluate(
                "JSON.parse(localStorage.getItem('jizura.project.v1'))"
            )
            if saved_project.get("themeId") != "lyricpv":
                raise RuntimeError("JIZURA did not keep the lyric typography theme")
            saved_project["style"] = "paper"
            saved_project["mood"] = "editorial"
            saved_project["unify"] = False
            fx = saved_project.setdefault("fx", {})
            fx.update(
                {
                    "motion": 0.38,
                    "glitch": 0.04,
                    "chroma": 0.12,
                    "decor": 0.26,
                    "density": 0.28,
                    "texture": 0.18,
                    "flash": False,
                    "onTwos": True,
                    "koma": 12,
                    "hud": "off",
                    "bgSwitch": 0.08,
                    "hideNo": True,
                    "hideTime": True,
                }
            )
            saved_project["includeAudio"] = False
            saved_project["colors"] = {**saved_project.get("colors", {}), **PALETTE}
            saved_project["timing"] = {
                "bpm": 0,
                "offset": 0,
                "snap": False,
                "tail": 0.9,
                "lineScale": 1.8,
            }
            pivot = int(timeline["pivot_index"])
            duration = float(timeline["duration"])
            overrides = {}
            base_layouts = (
                ("frameBox", "assemble", "wipe", ["grid"]),
                ("lowerThird", "type", "wipe", ["bars"]),
                ("labels", "assemble", "drift", ["grid"]),
            )
            for index, cue in enumerate(timeline["segments"]):
                source_index = int(cue.get("source_index", index))
                if index == pivot:
                    layout, enter, exit_motion, decor = (
                        "center",
                        "assemble",
                        "cut",
                        ["bars"],
                    )
                elif index == len(timeline["segments"]) - 1:
                    layout, enter, exit_motion, decor = (
                        "quote",
                        "type",
                        "drift",
                        [],
                    )
                else:
                    layout, enter, exit_motion, decor = base_layouts[
                        (source_index + int(cue.get("part_index", 0)) + index)
                        % len(base_layouts)
                    ]
                overrides[str(index)] = {
                    "layout": layout,
                    "enter": enter,
                    "exit": exit_motion,
                    "hold": "still",
                    "decor": decor,
                    "single": True,
                    "treat": "none",
                }
            saved_project["overrides"] = overrides
            selected_seed = page.evaluate(
                """({project, pivot, duration, startSeed}) => {
                    for (let attempt = 0; attempt < 10000; attempt++) {
                        const candidateSeed = (startSeed + attempt) >>> 0;
                        const candidate = {...project, seed: candidateSeed};
                        const plan = window.J.plan(candidate, {duration});
                        const first = plan.cuts.find(cut => cut.line === 0);
                        const before = plan.cuts.filter(cut => cut.line === pivot - 1).at(-1);
                        const turn = plan.cuts.find(cut => cut.line === pivot);
                        const beforeCuts = plan.cuts.filter(cut => cut.line >= 0 && cut.line < pivot);
                        const afterCuts = plan.cuts.filter(cut => cut.line > pivot);
                        if (first && before && turn && first.scheme === 0
                            && before.scheme === 0 && turn.scheme === 1
                            && beforeCuts.every(cut => cut.scheme === 0)
                            && afterCuts.every(cut => cut.scheme === 1)) {
                            return {seed: candidateSeed, beforeScheme: before.scheme,
                                pivotScheme: turn.scheme};
                        }
                    }
                    throw new Error('No deterministic JIZURA seed produced the pivot contrast');
                }""",
                {
                    "project": saved_project,
                    "pivot": pivot,
                    "duration": duration,
                    "startSeed": seed,
                },
            )
            saved_project["seed"] = int(selected_seed["seed"])
            import_project(page, saved_project, "byosan-jizura-final-project-")
            page.wait_for_function(
                """({pivot, seed}) => {
                    const saved = JSON.parse(localStorage.getItem('jizura.project.v1') || 'null');
                    return saved && saved.overrides && saved.overrides[String(pivot)]
                        && saved.overrides[String(pivot)].layout === 'center'
                        && saved.seed === seed;
                }""",
                arg={"pivot": pivot, "seed": int(selected_seed["seed"])},
                timeout=30_000,
            )
            page.evaluate(
                """() => {
                    const audio = document.querySelector('#outAudio');
                    if (audio && audio.checked) audio.click();
                    const aspect = document.querySelector('#outAspect');
                    if (aspect) aspect.value = '16:9';
                    const resolution = document.querySelector('#outRes');
                    if (resolution) resolution.value = '1080';
                    const fps = document.querySelector('#outFps');
                    if (fps) fps.value = '24';
                }"""
            )
            scene_ms = round((time.monotonic() - started) * 1000)
            print(f"[byosan-stage] stage=jizura_scene_generation elapsed_ms={scene_ms}", flush=True)
            export_started = time.monotonic()
            with page.expect_download(timeout=1_800_000) as download:
                page.click("#eMP4")
            download.value.save_as(str(output))
            export_ms = round((time.monotonic() - export_started) * 1000)
            print(f"[byosan-stage] stage=jizura_export elapsed_ms={export_ms}", flush=True)
            saved_project = page.evaluate(
                "JSON.parse(localStorage.getItem('jizura.project.v1'))"
            )
        finally:
            browser.close()
    project_output.write_text(
        json.dumps(saved_project, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    record = {
        "tool": "jizura",
        "version": JIZURA_VERSION.read_text(encoding="utf-8").strip(),
        "html_sha256": sha256(JIZURA_HTML),
        "project_sha256": sha256(project_output),
        "timeline_sha256": sha256(timeline_path),
        "lrc_sha256": sha256(lrc),
        "video_sha256": sha256(output),
        "theme_id": saved_project.get("themeId"),
        "style": saved_project.get("style"),
        "mood": saved_project.get("mood"),
        "seed": saved_project.get("seed"),
        "pivot_index": timeline["pivot_index"],
        "pivot_before_scheme": selected_seed["beforeScheme"],
        "pivot_scheme": selected_seed["pivotScheme"],
        "pivot_override": saved_project.get("overrides", {}).get(
            str(timeline["pivot_index"])
        ),
        "resolution": {"aspect": saved_project.get("aspect"), "height": 1080, "fps": 24},
        "palette": PALETTE,
        "pivot_scheme_palette": PIVOT_SCHEME,
        "renderer_sha256": sha256(Path(__file__)),
    }
    record_output.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    total_ms = round((time.monotonic() - started) * 1000)
    print(f"[byosan-stage] stage=jizura_total elapsed_ms={total_ms}", flush=True)
    print(f"JIZURA_VIDEO={output}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: byosan_jizura.py AUDIO TIMELINE_JSON OUTPUT_MP4")
    try:
        render(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"BYOSAN_JIZURA_RENDER_FAILED: {error}") from error
