import difflib
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
from bisect import bisect_left
from pathlib import Path

import yaml
from faster_whisper import WhisperModel
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((ROOT / "config/music/humanity.yaml").read_text())["pv"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def probe_duration(path: Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip())


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
        index = bisect_left(lyric_positions, start)
        if len(anchors) == 1:
            timestamp = anchor_times[0]
        else:
            left_index = 0 if index == 0 else min(index - 1, len(anchors) - 2)
            right_index = left_index + 1
            left_position, right_position = lyric_positions[left_index], lyric_positions[right_index]
            fraction = (start - left_position) / max(1, right_position - left_position)
            timestamp = anchor_times[left_index] + fraction * (
                anchor_times[right_index] - anchor_times[left_index]
            )
        timestamps.append(min(duration, max(0.0, timestamp)))

    raw_timestamps = timestamps[:]
    index = 0
    while index < len(raw_timestamps):
        end = index
        while end + 1 < len(raw_timestamps) and raw_timestamps[end + 1] - raw_timestamps[index] < 0.05:
            end += 1
        if end > index:
            left = raw_timestamps[index]
            right = raw_timestamps[end + 1] if end + 1 < len(raw_timestamps) else duration
            if right > left:
                for duplicate in range(index + 1, end + 1):
                    timestamps[duplicate] = left + (right - left) * (duplicate - index) / (end + 1 - index)
        index = end + 1

    for index in range(1, len(timestamps)):
        timestamps[index] = max(timestamps[index], timestamps[index - 1])
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
) -> tuple[dict, float | None, dict[str, int]]:
    stage_started = time.monotonic()
    theme = visual["theme_id"]
    style = visual["style_id"]
    mood = visual["mood_id"]
    if not isinstance(theme, str) or theme not in CFG["theme_ids"]:
        raise ValueError(f"unsupported JIZURA theme: {theme}")
    if not isinstance(style, str) or style not in CFG["style_ids"]:
        raise ValueError(f"unsupported JIZURA style: {style}")
    if not isinstance(mood, str) or mood not in CFG["mood_ids"]:
        raise ValueError(f"unsupported JIZURA mood: {mood}")
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
    arc = visual["visual_arc"]
    motif_layout_id = arc["motif_layout_id"]
    if motif_layout_id not in CFG["motif_layout_ids"]:
        raise ValueError(f"unsupported song motif layout: {motif_layout_id}")
    timed_rows = []
    for row in lrc.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"\[(\d+):(\d{2})\.(\d{2})\](.*)", row)
        if not match:
            raise ValueError("generated LRC contains an invalid timestamp")
        timed_rows.append((int(match.group(1)) * 60 + int(match.group(2)) + int(match.group(3)) / 100, match.group(4)))

    def marker_index(marker: str, last: bool = False) -> int:
        matches = [i for i, (_, line) in enumerate(timed_rows) if marker in line]
        if not matches:
            raise ValueError(f"JIZURA arc marker is absent from timed lyrics: {marker}")
        return matches[-1] if last else matches[0]

    opening_index = marker_index(arc["opening_hook"])
    clue_index = marker_index(arc["clue_lyric"])
    climax_index = marker_index(arc["climax_lyric"], last=True)
    opening_window = float(CFG["arc_opening_window_seconds"])
    if timed_rows[opening_index][0] > opening_window or timed_rows[clue_index][0] > opening_window:
        raise ValueError("opening hook and planted clue must be sung within 30 seconds")
    if climax_index <= clue_index:
        raise ValueError("climax marker must follow the planted clue")
    plan_started = time.monotonic()
    project = {
        "version": 1,
        "title": "",
        "artist": "",
        "lyrics": "",
        "themeId": theme,
        "style": style,
        "mood": mood,
        "aspect": "16:9",
        "res": 1080,
        "fps": 24,
        "includeAudio": False,
        "seed": seed,
        "unify": unify,
        "typeset": typeset,
        "lang": "ja",
        "fx": {"motion": 0.28, "glitch": 0.03, "chroma": 0.08, "decor": 0.2,
               "density": 0.28, "texture": 0.16, "flash": False, "onTwos": True,
               "koma": 12, "hud": "off", "bgSwitch": 0.12, "hideNo": True, "hideTime": True},
        "overrides": {},
    }
    project["overrides"][str(clue_index)] = {"single": True, "layout": "quote", "enter": "blur", "exit": "drift", "hold": "still", "decor": []}
    project["overrides"][str(climax_index)] = {"single": True, "layout": "center", "enter": "assemble", "exit": "blur", "hold": "still", "decor": ["bars"]}
    for index in range(climax_index + 1, len(timed_rows)):
        project["overrides"][str(index)] = {"single": True, "layout": "quote", "enter": "blur", "exit": "drift", "hold": "still", "decor": []}
    timeline_ms = round((time.monotonic() - plan_started) * 1000)
    setup_ms = export_ms = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CFG["chrome"], headless=True, args=["--no-sandbox"])
        try:
            page = browser.new_page(accept_downloads=True)
            page.goto((ROOT / CFG["jizura_html"]).as_uri(), wait_until="load")
            project["fx"] = page.evaluate(
                """({mood,seed,base}) => {
                    const recipe=J.MOODS?.[mood]?.fx;
                    if(!recipe) throw new Error('JIZURA mood profile is unavailable');
                    const rng=J.rng(seed), fx={...base};
                    for(const [key,range] of Object.entries(recipe))
                        fx[key]=Array.isArray(range)?range[0]+(range[1]-range[0])*rng():range;
                    return fx;
                }""",
                {"mood": mood, "seed": seed, "base": project["fx"]},
            )
            if mood == "calm":
                project["fx"].update({
                    "motion": min(project["fx"]["motion"], 0.24),
                    "glitch": 0,
                    "chroma": min(project["fx"]["chroma"], 0.06),
                    "decor": min(project["fx"]["decor"], 0.12),
                    "density": min(project["fx"]["density"], 0.22),
                    "texture": min(project["fx"]["texture"], 0.34),
                    "flash": False,
                    "onTwos": True,
                    "koma": 12,
                    "hud": "off",
                    "bgSwitch": 0.08,
                })
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
            saved_project = page.evaluate("JSON.parse(localStorage.getItem('jizura.project.v1'))")
            if saved_project.get("themeId") != theme:
                raise RuntimeError("JIZURA did not keep the selected story theme")
            if saved_project.get("style") != style or saved_project.get("mood") != mood:
                raise RuntimeError("JIZURA did not keep the authored song style and mood")
            if saved_project.get("includeAudio") is not False:
                raise RuntimeError("JIZURA project must leave audio embedding off")
            saved_project["colors"] = {"enabled": False, "accentOn": False}
            saved_project["unify"] = unify
            saved_project["fx"] = project["fx"]
            saved_project["overrides"] = project["overrides"]
            with tempfile.TemporaryDirectory(prefix="humanity-jizura-palette-") as temp_dir:
                project_input = Path(temp_dir) / "project.json"
                project_input.write_text(
                    json.dumps(saved_project, ensure_ascii=False), encoding="utf-8"
                )
                page.set_input_files("#fileProject", str(project_input))
            page.wait_for_function(
                """() => JSON.parse(localStorage.getItem('jizura.project.v1') || 'null')?.themeId""",
                timeout=30_000,
            )
            saved_project = page.evaluate("JSON.parse(localStorage.getItem('jizura.project.v1'))")
            saved_project["overrides"] = project["overrides"]
            saved_project["fx"] = project["fx"]
            saved_project["style"] = style
            saved_project["mood"] = mood
            saved_project["unify"] = unify
            saved_project["colors"] = {"enabled": False, "accentOn": False}
            climax_palette = visual["climax_palette"]
            page.evaluate(
                """({style, base, climax}) => {
                    const pack=window.J?.STYLES?.[style];
                    if(!pack?.schemes?.[1]) throw new Error('Selected JIZURA theme has no climax color scheme');
                    pack.schemes[0]={...pack.schemes[0], ...base};
                    pack.schemes[1]={...pack.schemes[1], ...climax};
                }""",
                {
                    "style": saved_project.get("style"),
                    "base": {"accent": palette["accent"].upper(), "ghostA": palette["ghost_a"].upper(), "ghostB": palette["ghost_b"].upper()},
                    "climax": {"bg": climax_palette["bg"].upper(), "fg": "#FFF8EF", "sub": "#F0D9C3",
                               "accent": climax_palette["accent"].upper(), "accent2": palette["ghost_b"].upper(),
                               "ink": climax_palette["bg"].upper(), "dim": "#A78D9A",
                               "ghostA": palette["ghost_a"].upper(), "ghostB": palette["ghost_b"].upper()},
                },
            )
            duration_seconds = probe_duration(audio)
            arc_indices = page.evaluate(
                """({project, clueMarker, climaxMarker, motifLayout, duration}) => {
                    const p={...project,overrides:{}};
                    const lyricLines=J.parseLyrics(p.lyrics).lines;
                    const motifDef=J.LAYOUTS[motifLayout];
                    if(!motifDef||typeof motifDef.plan!=='function') throw new Error('JIZURA does not contain the authored song motif layout');
                    const clue=lyricLines.findIndex(line=>line.text.includes(clueMarker));
                    const climaxMatches=lyricLines.map((line,index)=>line.text.includes(climaxMarker)?index:-1).filter(index=>index>=0);
                    const climax=climaxMatches.at(-1);
                    if(clue<0||climax==null) throw new Error('JIZURA parsed lyrics do not contain the authored arc markers');
                    for(let i=0;i<lyricLines.length;i++) p.overrides[String(i)]={single:true};
                    const base=J.plan(p,{duration});
                    if(!base.lines.length) throw new Error('JIZURA has no aligned lyric lines');
                    const motifParams=(cut,lineIndex)=>{
                        const [W,H]=J.designSize(p.aspect), rng=J.rng(J.h(cut.seed,motifLayout,lineIndex));
                        const n=[...cut.text.replace(/\\s+/g,'')].length;
                        return motifDef.plan(rng,{text:cut.text,n,W,H,dur:cut.end-cut.start},J.resolveStyle(p));
                    };
                    const quoteParams=(cut,lineIndex)=>{
                        const [W,H]=J.designSize(p.aspect), rng=J.rng(J.h(cut.seed,'quote',lineIndex));
                        const n=[...cut.text.replace(/\\s+/g,'')].length;
                        return J.LAYOUTS.quote.plan(rng,{text:cut.text,n,W,H,dur:cut.end-cut.start},J.resolveStyle(p));
                    };
                    for(let i=0;i<base.lines.length;i++) {
                        if(lyricLines[i].interlude) {
                            p.overrides[String(i)]={decor:[]};
                            continue;
                        }
                        const cut=base.cuts.find(c=>c.line===i);
                        if(!cut||typeof cut.text!=='string') throw new Error(`JIZURA cut missing for lyric line ${i}`);
                        const special=i===climax, clueLine=i===clue, after=i>climax;
                        const calm=p.mood==='calm';
                        const layout=special||clueLine?motifLayout:(after||calm?'quote':cut.layout);
                        const params=layout===motifLayout?motifParams(cut,i):(layout==='quote'&&cut.layout!=='quote'?quoteParams(cut,i):cut.params);
                        const locked={utext:cut.text,layout,
                            enter:special?'assemble':'blur',exit:special?'blur':'drift',hold:'still',
                            params,decor:[],treat:'none',treatP:{},
                            cam:calm&&!special&&!clueLine?'push':cut.cam,
                            camP:calm&&!special&&!clueLine?{a:0.015}:cut.camP,
                            weightGrow:cut.weightGrow,scheme:i<climax?0:1,
                            seed:cut.seed,bg:cut.bg,bgP:cut.bgP,inDur:cut.inDur,outDur:cut.outDur};
                        p.overrides[String(i)]={lock:true,lockedCuts:[locked]};
                    }
                    const originalPlan=J.plan.bind(J);
                    J.plan=(project,audio)=>{
                        const planned=originalPlan(project,audio);
                        for(const cut of planned.cuts) {
                            if(cut.layout==='interlude'&&cut.line>=0)
                                cut.scheme=cut.line<climax?0:1;
                        }
                        return planned;
                    };
                    const final=J.plan(p,{duration});
                    const pre=final.cuts.filter(c=>c.line>=0&&c.line<climax);
                    const turn=final.cuts.find(c=>c.line===climax);
                    const post=final.cuts.filter(c=>c.line>climax);
                    if(!turn||turn.scheme!==1||!pre.every(c=>c.scheme===0)||!post.every(c=>c.scheme===1))
                        throw new Error('JIZURA could not lock the early-to-climax visual transformation '+JSON.stringify(final.cuts.filter(c=>c.line>=0).map(c=>[c.line,c.scheme])));
                    return {project:p, clue, climax, motifLayout};
                }""",
                {"project": saved_project, "clueMarker": arc["clue_lyric"],
                 "climaxMarker": arc["climax_lyric"], "motifLayout": motif_layout_id,
                 "duration": duration_seconds},
            )
            saved_project = arc_indices["project"]
            clue_index = int(arc_indices["clue"])
            climax_index = int(arc_indices["climax"])
            with tempfile.TemporaryDirectory(prefix="humanity-jizura-arc-") as temp_dir:
                project_input = Path(temp_dir) / "project.json"
                project_input.write_text(json.dumps(saved_project, ensure_ascii=False), encoding="utf-8")
                page.set_input_files("#fileProject", str(project_input))
            page.wait_for_function(
                """({climax})=>{const p=JSON.parse(localStorage.getItem('jizura.project.v1')||'null');return p&&p.overrides?.[String(climax)]?.lock===true}""",
                arg={"climax": climax_index}, timeout=30_000,
            )
            saved_project = page.evaluate("JSON.parse(localStorage.getItem('jizura.project.v1'))")
            locked_climax = saved_project.get("overrides", {}).get(str(climax_index), {}).get("lockedCuts", [])
            if (
                not locked_climax
                or locked_climax[0].get("layout") != motif_layout_id
                or locked_climax[0].get("scheme") != 1
            ):
                raise RuntimeError("JIZURA did not retain the authored motif at climax")
            setup_ms = round((time.monotonic() - stage_started) * 1000)
            audio_status = page.locator("#audioName").text_content() or ""
            detected_bpm_match = re.search(r"約([0-9]+(?:\.[0-9]+)?)BPM", audio_status)
            detected_bpm = float(detected_bpm_match.group(1)) if detected_bpm_match else None
            export_started = time.monotonic()
            with page.expect_download(timeout=CFG["export_timeout_ms"]) as download:
                page.click("#eMP4")
            download.value.save_as(str(raw))
            export_ms = round((time.monotonic() - export_started) * 1000)
        finally:
            browser.close()
    project_output.write_text(
        json.dumps(saved_project, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return saved_project, detected_bpm, {
        "lrc_plan": timeline_ms, "jizura_setup": setup_ms, "jizura_export": export_ms,
        "opening_line": opening_index, "clue_line": clue_index, "climax_line": climax_index,
        "clue_seconds": round(timed_rows[clue_index][0], 2),
        "climax_seconds": round(timed_rows[climax_index][0], 2),
        "author_export_total": round((time.monotonic() - stage_started) * 1000),
    }


def lrc_matches(lrc: Path, lines: list[str], audio_duration: float) -> bool:
    rows = lrc.read_text(encoding="utf-8").splitlines()
    lyric_rows = []
    previous = -1.0
    for row in rows:
        match = re.fullmatch(r"\[(\d+):(\d{2})\.(\d{2})\](.*)", row)
        if not match:
            return False
        timestamp = int(match.group(1)) * 60 + int(match.group(2)) + int(match.group(3)) / 100
        if timestamp < previous or timestamp > audio_duration:
            return False
        previous = timestamp
        text = match.group(4)
        if re.fullmatch(r"\[\s*間奏\s+\d+(?:\.\d+)?秒?\s*\]", text):
            continue
        lyric_rows.append((timestamp, text))
    return len(lyric_rows) == len(lines) and [text for _, text in lyric_rows] == lines


def add_visual_holds(lrc: Path, duration: float) -> dict[str, float]:
    original_rows = lrc.read_text(encoding="utf-8").splitlines()
    rows = []
    parsed = []
    for row in original_rows:
        match = re.fullmatch(r"\[(\d+):(\d{2})\.(\d{2})\](.*)", row)
        if not match:
            raise ValueError("generated LRC contains an invalid timestamp")
        timestamp = int(match.group(1)) * 60 + int(match.group(2)) + int(match.group(3)) / 100
        text = match.group(4)
        if re.fullmatch(r"\[\s*間奏\s+\d+(?:\.\d+)?秒?\s*\]", text):
            continue
        rows.append(row)
        parsed.append((timestamp, text))
    lyrics = [(timestamp, text) for timestamp, text in parsed if not re.fullmatch(r"\[\s*間奏\s+\d+(?:\.\d+)?秒?\s*\]", text)]
    if not lyrics:
        raise ValueError("generated LRC contains no lyric cues")
    first_start = lyrics[0][0]
    last_start, last_text = lyrics[-1]
    holds = []
    if first_start >= 6:
        holds.append((0.0, first_start, "opening"))
    final_line_end = last_start + max(3.6, len(last_text) * 0.5 + 1.2)
    afterglow_start = min(max(last_start + 0.4, final_line_end), duration - 5.0)
    afterglow_seconds = duration - afterglow_start
    if afterglow_seconds >= 5:
        holds.append((afterglow_start, afterglow_seconds, "afterglow"))
    additions = []
    for start, seconds, _kind in holds:
        centiseconds = round(start * 100)
        minutes, remainder = divmod(centiseconds, 6000)
        whole_seconds, fraction = divmod(remainder, 100)
        additions.append(f"[{minutes:02d}:{whole_seconds:02d}.{fraction:02d}][間奏 {seconds:.2f}秒]")
    merged = [*rows, *additions]
    merged.sort(key=lambda row: (
        int(re.match(r"\[(\d+):", row).group(1)) * 60
        + float(re.match(r"\[\d+:(\d{2}\.\d{2})\]", row).group(1))
    ))
    lrc.write_text("\n".join(merged) + "\n", encoding="utf-8")
    return {
        "opening_interlude_seconds": round(first_start, 2) if any(kind == "opening" for _, _, kind in holds) else 0.0,
        "afterglow_start_seconds": round(afterglow_start, 2) if any(kind == "afterglow" for _, _, kind in holds) else 0.0,
        "afterglow_seconds": round(afterglow_seconds, 2) if any(kind == "afterglow" for _, _, kind in holds) else 0.0,
    }


def has_visual_holds(lrc: Path, duration: float) -> bool:
    holds = []
    for row in lrc.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"\[(\d+):(\d{2})\.(\d{2})\](.*)", row)
        if not match:
            return False
        text_match = re.fullmatch(r"\[\s*間奏\s+(\d+(?:\.\d+)?)秒?\s*\]", match.group(4))
        if text_match:
            timestamp = int(match.group(1)) * 60 + int(match.group(2)) + int(match.group(3)) / 100
            seconds = float(text_match.group(1))
            holds.append((timestamp, seconds))
    return (
        any(start == 0 and seconds >= 6 for start, seconds in holds)
        and any(start > 0 and abs(start + seconds - duration) <= 0.2 for start, seconds in holds)
    )


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
    total_started = time.monotonic()
    out.mkdir(parents=True, exist_ok=True)
    lrc = out / "song.lrc"
    raw = out / "jizura.mp4"
    video = out / "video.mp4"
    project_output = out / "jizura.project.json"
    visual = json.loads(visual_path.read_text(encoding="utf-8"))
    source_lyrics = lyric_lines(lyrics.read_text(encoding="utf-8"))
    detected_bpm = None
    previous_record = {}
    pv_record = out / "pv.json"
    reusable_render = video.exists() and project_output.exists() and lrc.exists() and pv_record.exists() and not raw.exists()
    if reusable_render:
        previous_record = json.loads(pv_record.read_text(encoding="utf-8"))
        saved_project = json.loads(project_output.read_text(encoding="utf-8"))
        duration = probe_duration(audio)
        reusable_render = (
            previous_record.get("tool") == "jizura"
            and previous_record.get("audio_sha256") == sha256(audio)
            and previous_record.get("visual_plan_sha256") == sha256(visual_path)
            and previous_record.get("lrc_sha256") == sha256(lrc)
            and saved_project.get("title") == ""
            and saved_project.get("themeId") == visual["theme_id"]
            and saved_project.get("includeAudio") is False
            and lrc_matches(lrc, source_lyrics, duration)
            and has_visual_holds(lrc, duration)
        )
        if reusable_render and not has_audio(video):
            muxed_video = out / "video.with-audio.mp4"
            mux_video_audio(video, audio, muxed_video)
            muxed_video.replace(video)
    timings = previous_record.get("timings_ms", {}) if reusable_render else {}
    visual_holds = previous_record.get("visual_holds", {}) if reusable_render else {}
    if not reusable_render:
        if lrc.exists() and lrc_matches(lrc, source_lyrics, probe_duration(audio)):
            timings["alignment"] = 0
            timings["alignment_reused"] = 1
        else:
            align_started = time.monotonic()
            lrc.write_text(align(audio, source_lyrics), encoding="utf-8")
            timings["alignment"] = round((time.monotonic() - align_started) * 1000)
            timings["alignment_reused"] = 0
        lrc_plan_started = time.monotonic()
        visual_holds = add_visual_holds(lrc, probe_duration(audio))
        lrc_plan_ms = round((time.monotonic() - lrc_plan_started) * 1000)
        saved_project, detected_bpm, render_timings = export(lrc, audio, visual, raw, project_output)
        timings.update(render_timings)
        timings["lrc_plan"] = timings.get("lrc_plan", 0) + lrc_plan_ms
        mux_started = time.monotonic()
        mux_video_audio(raw, audio, video)
        timings["ffmpeg_mux"] = round((time.monotonic() - mux_started) * 1000)
        raw.unlink()
    timings["total"] = round((time.monotonic() - total_started) * 1000)
    (out / "pv.json").write_text(
        json.dumps(
            {
                "tool": "jizura",
                "title": visual["title"],
                "jizura_version": (ROOT / CFG["jizura_version"]).read_text().strip(),
                "jizura_sha256": sha256(ROOT / CFG["jizura_html"]),
                "project_sha256": sha256(project_output),
                "visual_plan_sha256": sha256(visual_path),
                "audio_sha256": sha256(audio),
                "lyrics_sha256": sha256(lyrics),
                "theme_id": saved_project.get("themeId"),
                "style_id": visual["style_id"],
                "mood_id": visual["mood_id"],
                "style": saved_project.get("style"),
                "mood": saved_project.get("mood"),
                "detected_bpm": detected_bpm,
                "beat_sync": detected_bpm is not None,
                "seed": saved_project.get("seed"),
                "unify": saved_project.get("unify"),
                "typeset": saved_project.get("typeset"),
                "palette": {
                    "accent": visual["palette"]["accent"].upper(),
                    "ghost_a": visual["palette"]["ghost_a"].upper(),
                    "ghost_b": visual["palette"]["ghost_b"].upper(),
                },
                "motif_layout_id": visual["visual_arc"]["motif_layout_id"],
                "source_duration_seconds": probe_duration(audio),
                "video_duration_seconds": probe_duration(video),
                "sync_delta_seconds": round(abs(probe_duration(video) - probe_duration(audio)), 4),
                "rationale": visual["rationale"],
                "visual_arc": visual["visual_arc"],
                "visual_holds": visual_holds,
                "climax_palette": {
                    key: value.upper()
                    for key, value in visual["climax_palette"].items()
                },
                "timings_ms": timings,
                "whisper_model": CFG["whisper_model"],
                "lrc_sha256": sha256(lrc),
                "sha256": sha256(video),
            }
        )
    )
    print(f"[humanity-pv] timings_ms={json.dumps(timings, separators=(',', ':'))}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("usage: humanity_pv.py AUDIO LYRICS JIZURA_PLAN OUTPUT_DIR")
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
