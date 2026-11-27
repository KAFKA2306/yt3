#!/usr/bin/env python3
"""Render quiet, dialogue-timed Yawa visuals with the pinned JIZURA app."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import yaml
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
JIZURA_HTML = ROOT / "vendor" / "jizura" / "index.html"
JIZURA_VERSION = ROOT / "vendor" / "jizura" / "VERSION"
DURATION_TOLERANCE = max(
    float(yaml.safe_load((ROOT / "config/yawa/runtime.yaml").read_text())["audit"]["duration_tolerance_seconds"]),
    0.25,
)
QUIET_SCHEME = {
    "bg": "#252533", "fg": "#F4EBDD", "sub": "#D5C6B4", "accent": "#D9A875",
    "accent2": "#A8B7B8", "ink": "#252533", "dim": "#68616B",
    "ghostA": "#A8B7B8", "ghostB": "#C49A91", "paper": False,
}
WARM_SCHEME = {
    "bg": "#352C35", "fg": "#FFF0D8", "sub": "#E7CFB2", "accent": "#E8B77D",
    "accent2": "#C89583", "ink": "#352C35", "dim": "#7B6870",
    "ghostA": "#C49A91", "ghostB": "#D9B875", "paper": False,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def duration(path: Path) -> float:
    return float(subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ], check=True, capture_output=True, text=True).stdout.strip())


def lrc_stamp(seconds: float) -> str:
    value = round(max(0, seconds) * 100)
    minutes, rem = divmod(value, 6000)
    seconds, centis = divmod(rem, 100)
    return f"[{minutes:02d}:{seconds:02d}.{centis:02d}]"


def performances(script: dict) -> list[dict]:
    rows = script.get("performances", [])
    if not rows:
        rows = [row for chapter in script.get("chapters", []) for row in chapter.get("performances", [])]
    if not rows:
        raise ValueError("Yawa script contains no performances")
    return rows


def audio_for(tts_dir: Path, index: int) -> Path:
    for name in (f"performance_{index + 1:05d}.wav", f"line_{index:03d}.wav", f"{index:03d}.wav"):
        candidate = tts_dir / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Missing TTS audio for performance {index + 1} in {tts_dir}")


def write_timeline(script: dict, tts_dir: Path, audio_duration: float, lrc: Path) -> tuple[list[dict], int, int]:
    rows, time_cursor = [], 0.0
    clue_created = False
    sensory_pattern = re.compile(r"光|明かり|灯り|風|雨|雪|湯気|湯|音|紙|本|香り|匂い|カップ|影|手触り|花びら|しおり|滴|水音|足音")
    cast = {voice.get("id"): voice for voice in script.get("voices", [])}
    for index, item in enumerate(performances(script)):
        wav = audio_for(tts_dir, index)
        wav_seconds = duration(wav)
        voice = cast.get(item.get("voice_id"), {})
        name = str(voice.get("character_id") or item.get("voice_id") or "夜話")
        spoken = " ".join(str(item.get("text", "")).split()).strip()
        if not spoken:
            raise ValueError(f"Yawa performance {index + 1} has no text")
        # JIZURA receives a quiet cue, not a transcript block; the full voice performance stays in audio.
        line = next((part.strip() for part in re.split(r"(?<=[。！？…])", spoken) if part.strip()), spoken)
        if len(line) > 22:
            line = line[:21].rstrip("、。 ") + "…"
        # Keep the audio untouched: cue timestamps use the already-produced performance WAVs and pauses.
        start = min(time_cursor, audio_duration)
        rows.append({"start": start, "text": line, "voice": name,
                     "kind": item.get("kind", "dialogue"), "acting": str(item.get("acting", "")),
                     "performance_index": index})
        if not clue_created and start < 30:
            sensory = None
            for sentence in re.split(r"(?<=[。！？…])", spoken):
                clauses = [part.strip() for part in re.split(r"[、。！？…]", sentence) if part.strip()]
                for clause_index, clause in enumerate(clauses):
                    if sensory_pattern.search(clause):
                        context = clauses[clause_index - 1] if clause_index else ""
                        if context.endswith(("からは", "では", "の", "に", "を", "は")):
                            clause = f"{context}、{clause}"
                        if sentence.rstrip().endswith("。") and clause_index == len(clauses) - 1:
                            clause += "。"
                        sensory = clause
                        break
                if sensory:
                    break
            if sensory:
                fraction = spoken.find(sensory) / max(1, len(spoken))
                clue_start = min(audio_duration, time_cursor + min(max(0.2, wav_seconds - 0.2), wav_seconds * fraction))
                if clue_start <= 30:
                    clue_text = sensory
                    if len(clue_text) > 22:
                        clue_text = clue_text[:21].rstrip("、。 ") + "…"
                    rows.append({"start": clue_start, "text": clue_text, "voice": name,
                                 "kind": "early_sensory_clue", "acting": str(item.get("acting", "")),
                                 "performance_index": index})
                    clue_created = True
        pause = tts_dir / f"pause_{index + 1:05d}.wav"
        time_cursor += wav_seconds + (duration(pause) if pause.exists() else float(item.get("pause_after_seconds", 0.4) or 0.4))
    clue_candidates = [i for i, row in enumerate(rows) if row.get("kind") == "early_sensory_clue"]
    if not clue_candidates or rows[clue_candidates[0]]["start"] > 30:
        raise ValueError("Yawa story has no sensory or place clue in the first 30 seconds")
    clue = clue_candidates[0]
    if audio_duration - rows[-1]["start"] > 6.0:
        closing_start = max(rows[-1]["start"] + 4.0, audio_duration - 4.5)
        if closing_start < audio_duration:
            rows.append({**rows[-1], "start": closing_start, "kind": "closing_hold"})
    rows.sort(key=lambda row: row["start"])
    pivot_candidates = [
        i for i, row in enumerate(rows)
        if i > clue and audio_duration * 0.25 <= row["start"] <= audio_duration * 0.82
        and re.search(r"見つ|わかった|分かった|なるほど|ありがとう|よかった|決め|約束|続き|一緒|思い出|安心|そうか", row["text"])
    ]
    pivot = pivot_candidates[len(pivot_candidates) // 2] if pivot_candidates else max(clue + 1, len(rows) // 2)
    pivot = max(clue + 1, min(len(rows) - 1, pivot))
    # Keep one short cue per performance and one separately timed sensory clue; never alter the voice track.
    lrc.write_text("\n".join(f"{lrc_stamp(row['start'])}{row['text']}" for row in rows) + "\n", encoding="utf-8")
    if len(rows) < 2:
        raise ValueError("Yawa quiet JIZURA needs at least two performances for a visual turn")
    return rows, clue, pivot


def import_project(page, project: dict) -> None:
    with tempfile.TemporaryDirectory(prefix="yawa-jizura-project-") as tmp:
        project_path = Path(tmp) / "project.json"
        project_path.write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")
        page.set_input_files("#fileProject", str(project_path))


def render(audio: Path, script_path: Path, tts_dir: Path, output: Path) -> None:
    started = time.monotonic()
    if not JIZURA_HTML.is_file() or not JIZURA_VERSION.is_file():
        raise FileNotFoundError("Pinned JIZURA HTML or VERSION is missing")
    script = json.loads(script_path.read_text(encoding="utf-8"))
    audio_seconds = duration(audio)
    output.parent.mkdir(parents=True, exist_ok=True)
    lrc, project_file = output.with_suffix(".lrc"), output.with_suffix(".jizura.project.json")
    record_file = output.with_name(f"{output.stem}.jizura.json")
    stage_start = time.monotonic()
    cues, clue, pivot = write_timeline(script, tts_dir, audio_seconds, lrc)
    lrc_plan_ms = round((time.monotonic() - stage_start) * 1000)
    seed = int.from_bytes(hashlib.sha256(script_path.read_bytes()).digest()[:4], "big")
    project = {
        "version": 1, "timingOrder": 2, "themeId": "lyricpv", "title": "夜話アーカイブ",
        "artist": "夜話アーカイブ", "lyrics": lrc.read_text(encoding="utf-8"),
        "style": "noir", "mood": "calm",
        "extra": False, "wa": False, "horror": False, "typo": True, "kinetic": False,
        "lang": "ja", "keyBg": "off", "unify": False, "typeset": True,
        "seed": seed, "aspect": "16:9", "res": 1080, "fps": 24, "includeAudio": False,
        "colors": {"enabled": True, "accentOn": True, "bg": "#252533", "fg": "#F4EBDD", "sub": "#D5C6B4",
                   "accent": "#D9A875", "ghostA": "#A8B7B8", "ghostB": "#C49A91"},
        "fx": {"motion": 0.08, "glitch": 0, "chroma": 0, "decor": 0.08, "density": 0.12,
               "texture": 0.1, "flash": False, "onTwos": True, "koma": 8, "hud": "off",
               "bgSwitch": 0.1, "hideNo": True, "hideTime": True},
        "timing": {"bpm": 0, "offset": 0, "snap": False, "tail": 1, "lineScale": 1},
        "overrides": {},
    }
    for i in range(len(cues)):
        project["overrides"][str(i)] = {
            "single": True, "layout": "quote", "enter": "blur", "exit": "drift",
            "hold": "still", "decor": [], "cam": "push",
        }
    project["overrides"][str(clue)] = {
        "single": True, "layout": "center", "enter": "blur", "exit": "drift",
        "hold": "still", "decor": [], "cam": "push",
    }
    project["overrides"][str(pivot)] = {
        "single": True, "layout": "center", "enter": "blur", "exit": "blur",
        "hold": "still", "decor": [], "cam": "push",
    }
    setup_ms = export_ms = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])
        try:
            page = browser.new_page(accept_downloads=True)
            page.goto(JIZURA_HTML.as_uri(), wait_until="load")
            setup_start = time.monotonic()
            page.evaluate("""({quiet, warm}) => { const pack=window.J?.STYLES?.noir; if(!pack?.schemes?.[1]) throw new Error('JIZURA quiet schemes unavailable'); pack.schemes[0]={...pack.schemes[0],...quiet}; pack.schemes[1]={...pack.schemes[1],...warm}; }""", {"quiet": QUIET_SCHEME, "warm": WARM_SCHEME})
            import_project(page, project)
            page.set_input_files("#audioFile", str(audio))
            page.wait_for_function("document.querySelector('#timeDur')?.textContent.trim() !== '00:00.00' && !document.querySelector('#audioName')?.textContent.includes('解析中')", timeout=300_000)
            page.set_input_files("#fileLrc", str(lrc))
            page.wait_for_function("document.querySelectorAll('#lineList li').length > 0", timeout=30_000)
            skip = page.locator(".tour-skip")
            if skip.is_visible(): skip.click()
            page.click("#modeEasy")
            saved = page.evaluate("JSON.parse(localStorage.getItem('jizura.project.v1'))")
            saved.update(project)
            saved["style"], saved["mood"] = "noir", "calm"
            saved["colors"] = project["colors"]
            saved["fx"] = project["fx"]
            arc = page.evaluate("""({project,pivot,duration}) => {
                const p={...project,overrides:{}};
                const count=J.parseLyrics(p.lyrics).lines.length;
                if(!count||pivot<=0||pivot>=count) throw new Error('JIZURA arc has no opening or resolution lines');
                for(let i=0;i<count;i++) p.overrides[String(i)]={single:true,decor:[],bg:'none'};
                const base=J.plan(p,{duration});
                if(!base.cuts.length) throw new Error('JIZURA could not plan the authored dialogue cues');
                for(let i=0;i<count;i++) {
                    const cut=base.cuts.find(c=>c.line===i&&c.layout!=='interlude');
                    if(!cut) throw new Error(`JIZURA cue ${i} has no planned cut`);
                    const isTurn=i===pivot;
                    const locked={utext:cut.text,layout:'quote',enter:'blur',
                        exit:isTurn?'blur':'drift',hold:'still',params:cut.params,decor:[],
                        treat:'none',treatP:{},cam:cut.cam,camP:cut.camP,weightGrow:cut.weightGrow,
                        scheme:i<pivot?0:1,seed:cut.seed,bg:'none',bgP:{},
                        inDur:cut.inDur,outDur:cut.outDur};
                    p.overrides[String(i)]={lock:true,lockedCuts:[locked],decor:[],bg:'none'};
                }
                let selected=null, checked=0, selectedCuts=[];
                for(let n=0;n<1024;n++) {
                    const seed=(project.seed+n)>>>0;
                    const cuts=J.plan({...p,seed},{duration}).cuts.filter(c=>c.line>=0);
                    const before=cuts.filter(c=>c.line<pivot);
                    const turn=cuts.filter(c=>c.line===pivot);
                    const after=cuts.filter(c=>c.line>pivot);
                    checked++;
                    if(turn.length&&before.every(c=>c.scheme===0)&&turn.every(c=>c.scheme===1)&&after.every(c=>c.scheme===1)) {
                        selected=seed; selectedCuts=cuts; break;
                    }
                }
                if(selected==null) throw new Error('JIZURA could not find a seed with one quiet-to-warm turn');
                p.seed=selected;
                return {project:p, count, checked, before: selectedCuts.filter(c=>c.line<pivot).length,
                    turn: selectedCuts.filter(c=>c.line===pivot).length,
                    after: selectedCuts.filter(c=>c.line>pivot).length};
            }""", {"project": saved, "pivot": pivot, "duration": audio_seconds})
            saved = arc["project"]
            import_project(page, saved)
            page.wait_for_function("""({seed,pivot})=>{const p=JSON.parse(localStorage.getItem('jizura.project.v1')||'null');return p&&p.seed===seed&&p.overrides?.[String(pivot)]?.lock===true&&p.lyrics.trim().length>0}""", arg={"seed": saved["seed"], "pivot": pivot}, timeout=30_000)
            page.evaluate("""() => {const a=document.querySelector('#outAudio'); if(a?.checked)a.click(); const r=document.querySelector('#outRes'); if(r)r.value='1080'; const f=document.querySelector('#outFps');if(f)f.value='24';}""")
            setup_ms = round((time.monotonic() - setup_start) * 1000)
            export_start = time.monotonic()
            with page.expect_download(timeout=1_800_000) as download: page.click("#eMP4")
            download.value.save_as(str(output))
            export_ms = round((time.monotonic() - export_start) * 1000)
            saved = page.evaluate("JSON.parse(localStorage.getItem('jizura.project.v1'))")
        finally:
            browser.close()
    project_file.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    mux_start = time.monotonic()
    muxed = output.with_name(f"{output.stem}.mux.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(output), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-crf", "22", "-pix_fmt", "yuv420p", "-r", "24", "-c:a", "aac", "-b:a", "192k", "-shortest", "-t", f"{audio_seconds:.6f}", "-movflags", "+faststart", str(muxed)], check=True)
    muxed.replace(output)
    mux_ms = round((time.monotonic() - mux_start) * 1000)
    if abs(duration(output) - audio_seconds) > DURATION_TOLERANCE:
        raise RuntimeError("Yawa JIZURA output duration differs from source audio")
    record_file.write_text(json.dumps({
        "tool": "jizura", "jizura_version": JIZURA_VERSION.read_text().strip(),
        "jizura_sha256": sha256(JIZURA_HTML), "renderer_sha256": sha256(Path(__file__)),
        "source_audio_sha256": sha256(audio), "script_sha256": sha256(script_path),
        "project_sha256": sha256(project_file), "video_sha256": sha256(output),
        "width": 1920, "height": 1080, "fps": 24, "duration_seconds": duration(output),
        "cue_count": len(cues), "quiet_to_warm_pivot_index": pivot,
        "early_sensory_clue_index": clue,
        "early_sensory_clue_seconds": cues[clue]["start"],
        "early_sensory_clue_text": cues[clue]["text"],
        "closing_visual_hold": cues[-1]["kind"] == "closing_hold",
        "pivot_seconds": cues[pivot]["start"],
        "timings_ms": {"lrc_plan": lrc_plan_ms, "setup": setup_ms,
                       "export_render": export_ms, "mux": mux_ms,
                       "total": round((time.monotonic() - started) * 1000)},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[yawa-jizura] timings_ms={json.dumps({ 'lrc_plan': lrc_plan_ms, 'jizura_setup': setup_ms, 'jizura_export': export_ms, 'ffmpeg_mux': mux_ms, 'total': round((time.monotonic() - started) * 1000) }, separators=(',', ':'))}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("usage: yawa_jizura.py AUDIO SCRIPT TTS_DIR OUTPUT_MP4")
    try:
        render(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"YAWA_JIZURA_RENDER_FAILED: {error}") from error
