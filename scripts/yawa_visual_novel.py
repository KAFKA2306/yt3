#!/usr/bin/env python3
"""Yawa Archive Visual Novel Renderer (standing cast portraits + expressions + VN dialogue box)."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PORTRAITS_ROOT = ROOT / "data" / "state" / "yawa" / "portraits"
CAST_PATH = ROOT / "docs" / "yawa" / "characters.json"

FONT_SERIF_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]
FONT_BOLD_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
]


def pick_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def probe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    ).strip()
    return float(out)


def key_out_green(img: Image.Image) -> Image.Image:
    """Remove solid chroma-green (#00FF00) background cleanly with vectorized NumPy despill."""
    arr = np.array(img.convert("RGBA"), dtype=np.int16)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    max_rb = np.maximum(r, b)
    green_diff = g - max_rb
    hard = (g > 110) & (green_diff > 45)
    soft = (~hard) & (g > 90) & (green_diff > 20)
    arr[hard, 3] = 0
    if np.any(soft):
        alpha = np.clip((255.0 * (1.0 - (green_diff[soft] - 20.0) / 25.0)).astype(np.int16), 0, 255)
        arr[soft, 3] = alpha
        arr[soft, 1] = np.minimum(g[soft], max_rb[soft] + 12)
    return Image.fromarray(arr.astype(np.uint8))


def choose_expression(acting: str, text: str) -> str:
    combined = f"{acting} {text}"
    if re.search(r"照れ|恥ずかし|赤面|ども|戸惑|えっ|うっ|もう|やだ", combined):
        return "shy"
    if re.search(r"笑|嬉|楽し|微笑|ニコ|ふふ|あは|ありがとう|よかった|おいし|好き", combined):
        return "smile"
    return "neutral"


KINSOKU_LINE_START = set("、。，．！？…ー」』）】・:;!?.,")
NARRATION_TAGS = {"語り", "ナレーション", "ナレーター", "モノローグ", "地の文"}
BRACKET_SPEAKER_RE = re.compile(r"^\s*【([^】]{1,16})】\s*")


def parse_speaker_and_text(
    raw_text: str,
    default_speaker: str,
    cast_names: dict[str, str],
) -> tuple[str, str, bool]:
    """Resolve display speaker & cleaned text. Strips leading 【語り】 narration tags cleanly."""
    clean = re.sub(r"\s+", " ", raw_text).strip()
    m = BRACKET_SPEAKER_RE.match(clean)
    if not m:
        return default_speaker, clean, False
    tag = m.group(1).strip()
    body = clean[m.end() :].strip()
    if tag in NARRATION_TAGS:
        return "", body, True
    # Match explicit cast name if present
    tag_no_space = tag.replace(" ", "").replace("\u3000", "")
    for name in cast_names.values():
        name_no_space = name.replace(" ", "").replace("\u3000", "")
        parts = [p for p in name.split() if len(p) >= 2]
        if tag_no_space == name_no_space or any(tag_no_space == p for p in parts):
            return name, body, False
    return tag, body, False


def wrap_japanese(
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
    max_lines: int = 4,
) -> tuple[list[str], bool]:
    """Wrap Japanese text cleanly with line-start kinsoku; returns (lines, truncated)."""
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return [], False
    lines: list[str] = []
    cur = ""
    idx = 0
    n = len(clean)
    while idx < n:
        ch = clean[idx]
        test = cur + ch
        bbox = font.getbbox(test)
        if bbox[2] - bbox[0] <= max_width or not cur:
            cur = test
            idx += 1
        else:
            # Avoid starting next line with Japanese punctuation (kinsoku)
            if ch in KINSOKU_LINE_START and len(cur) > 1:
                cur += ch
                idx += 1
            lines.append(cur)
            cur = ""
            if len(lines) >= max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    truncated = idx < n
    if truncated and lines:
        lines[-1] = lines[-1].rstrip("、。 ")[:-1] + "…"
    return lines, truncated


def fit_dialogue_lines(
    text: str,
    max_width: int,
) -> tuple[ImageFont.FreeTypeFont, list[str], int]:
    """Pick the largest readable serif font (40 -> 35 -> 30px) that fits without truncation."""
    for size, line_h, max_lines in [(40, 56, 3), (35, 48, 4), (30, 42, 4)]:
        font = pick_font(FONT_SERIF_CANDIDATES, size)
        lines, truncated = wrap_japanese(text, font, max_width, max_lines=max_lines)
        if not truncated:
            return font, lines, line_h
    font = pick_font(FONT_SERIF_CANDIDATES, 30)
    lines, _ = wrap_japanese(text, font, max_width, max_lines=4)
    return font, lines, 42


def load_cast_names() -> dict[str, str]:
    if not CAST_PATH.exists():
        return {}
    doc = json.loads(CAST_PATH.read_text(encoding="utf-8"))
    return {c["id"]: c["name"] for c in doc.get("characters", []) if "id" in c and "name" in c}


def build_background(bg_path: Path | None, width: int, height: int) -> Image.Image:
    if bg_path and bg_path.exists():
        bg = Image.open(bg_path).convert("RGB")
        # Cover crop to target aspect ratio
        bw, bh = bg.size
        scale = max(width / bw, height / bh)
        nw, nh = int(bw * scale), int(bh * scale)
        bg = bg.resize((nw, nh), Image.Resampling.LANCZOS)
        left = (nw - width) // 2
        top = (nh - height) // 2
        bg = bg.crop((left, top, left + width, top + height))
        # Strong atmospheric bokeh blur prevents thumbnail character from ghosting behind standing sprite
        bg = bg.filter(ImageFilter.GaussianBlur(radius=14.0))
        bg = ImageEnhance.Brightness(bg).enhance(0.54)
    else:
        bg = Image.new("RGB", (width, height), (20, 22, 34))

    # Warm vignette overlay for calm visual novel mood
    overlay = Image.new("RGBA", (width, height), (14, 12, 22, 55))
    return Image.alpha_composite(bg.convert("RGBA"), overlay)


def load_portrait(char_id: str, expression: str, target_h: int) -> Image.Image | None:
    for cand in [
        PORTRAITS_ROOT / char_id / f"{expression}.png",
        PORTRAITS_ROOT / char_id / "neutral.png",
    ]:
        if cand.exists():
            cache_path = cand.with_name(f"{cand.stem}.keyed.png")
            if cache_path.exists() and cache_path.stat().st_mtime >= cand.stat().st_mtime:
                keyed = Image.open(cache_path).convert("RGBA")
            else:
                keyed = key_out_green(Image.open(cand))
                try:
                    keyed.save(cache_path, "PNG")
                except OSError:
                    pass
            w, h = keyed.size
            scale = target_h / h
            return keyed.resize((int(w * scale), target_h), Image.Resampling.LANCZOS)
    return None


def render_frame(
    bg: Image.Image,
    portrait: Image.Image | None,
    speaker_name: str,
    text: str,
    episode_title: str,
    font_body: ImageFont.FreeTypeFont,
    font_name: ImageFont.FreeTypeFont,
    font_small: ImageFont.FreeTypeFont,
) -> Image.Image:
    width, height = bg.size
    canvas = bg.copy()

    if portrait is not None:
        pw, ph = portrait.size
        px = (width - pw) // 2
        py = height - ph + 40
        canvas.alpha_composite(portrait, (px, py))

    draw = ImageDraw.Draw(canvas, "RGBA")

    # Top-left subtle series & episode watermark
    draw.text(
        (48, 34),
        f"夜話アーカイブ  |  {episode_title}",
        font=font_small,
        fill=(245, 236, 220, 175),
    )

    # Visual Novel dialogue box at bottom
    box_margin_x = 120
    box_top = height - 300
    box_bottom = height - 44
    draw.rounded_rectangle(
        [box_margin_x, box_top, width - box_margin_x, box_bottom],
        radius=22,
        fill=(15, 16, 26, 208),
        outline=(226, 194, 138, 165),
        width=2,
    )

    # Speaker nameplate pill
    if speaker_name:
        nb = font_name.getbbox(speaker_name)
        nw = (nb[2] - nb[0]) + 56
        nh = 52
        nx1 = box_margin_x + 34
        ny1 = box_top - 28
        draw.rounded_rectangle(
            [nx1, ny1, nx1 + nw, ny1 + nh],
            radius=14,
            fill=(42, 34, 52, 238),
            outline=(235, 200, 140, 210),
            width=2,
        )
        draw.text(
            (nx1 + 28, ny1 + 9),
            speaker_name,
            font=font_name,
            fill=(252, 238, 210, 255),
        )

    # Dialogue text (auto-fit font so lines are never prematurely truncated)
    max_text_w = (width - box_margin_x * 2) - 104
    fit_font, lines, line_h = fit_dialogue_lines(text, max_text_w)
    total_text_h = len(lines) * line_h
    box_inner_top = box_top + 30
    box_inner_h = (box_bottom - box_inner_top) - 18
    ty = box_inner_top + max(0, (box_inner_h - total_text_h) // 2)
    for line in lines:
        draw.text((box_margin_x + 54, ty + 2), line, font=fit_font, fill=(0, 0, 0, 160))
        draw.text((box_margin_x + 52, ty), line, font=fit_font, fill=(250, 248, 242, 255))
        ty += line_h

    return canvas.convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--script", required=True)
    parser.add_argument("--tts-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--background", default="")
    args = parser.parse_args()

    audio_path = Path(args.audio)
    script_path = Path(args.script)
    tts_dir = Path(args.tts_dir)
    output_path = Path(args.output)
    run_dir = output_path.parent

    script = json.loads(script_path.read_text(encoding="utf-8"))
    episode_title = str(script.get("title", "夜話アーカイブ"))
    voices = {v["id"]: v for v in script.get("voices", []) if "id" in v}
    cast_names = load_cast_names()

    performances = script.get("performances", [])
    if not performances:
        for ch in script.get("chapters", []):
            performances.extend(ch.get("performances", []))

    bg_candidate = Path(args.background) if args.background else (run_dir / "thumbnail.jpg")
    width, height = 1920, 1080
    bg = build_background(bg_candidate if bg_candidate.exists() else None, width, height)

    font_body = pick_font(FONT_SERIF_CANDIDATES, 42)
    font_name = pick_font(FONT_BOLD_CANDIDATES, 28)
    font_small = pick_font(FONT_SERIF_CANDIDATES, 22)

    portrait_cache: dict[tuple[str, str], Image.Image | None] = {}
    audio_duration = probe_duration(audio_path)

    with tempfile.TemporaryDirectory(prefix="yawa-vn-") as tmp:
        tmp_dir = Path(tmp)
        concat_lines: list[str] = []
        used_portraits: set[str] = set()
        total_assigned = 0.0

        for idx, perf in enumerate(performances):
            one_based = idx + 1
            wav_path = tts_dir / f"performance_{one_based:05d}.wav"
            if not wav_path.exists():
                wav_path = tts_dir / f"line_{idx:03d}.wav"
            if not wav_path.exists():
                wav_path = tts_dir / f"{idx:03d}.wav"
            if not wav_path.exists():
                raise FileNotFoundError(
                    f"Missing TTS audio for performance {one_based} in {tts_dir}"
                )
            dur = probe_duration(wav_path)
            pause_wav = tts_dir / f"pause_{one_based:05d}.wav"
            if pause_wav.exists():
                pause = probe_duration(pause_wav)
            else:
                pause = float(perf.get("pause_after_seconds", 0.4) or 0.4)
            seg_dur = max(0.1, dur + pause)

            vid = str(perf.get("voice_id", ""))
            vinfo = voices.get(vid, {})
            char_id = str(vinfo.get("character_id") or vid)
            default_speaker = cast_names.get(char_id, char_id)
            acting = str(perf.get("acting", ""))
            raw_text = str(perf.get("text", ""))
            speaker, text, is_narration = parse_speaker_and_text(
                raw_text, default_speaker, cast_names
            )
            expr = "neutral" if is_narration else choose_expression(acting, text)

            key = (char_id, expr)
            if key not in portrait_cache:
                portrait_cache[key] = load_portrait(char_id, expr, int(height * 0.90))
            portrait = portrait_cache[key]
            if portrait is not None:
                used_portraits.add(f"{char_id}/{expr}")

            frame_img = render_frame(
                bg,
                portrait,
                speaker,
                text,
                episode_title,
                font_body,
                font_name,
                font_small,
            )
            frame_file = tmp_dir / f"frame_{idx:04d}.png"
            frame_img.save(frame_file, "PNG")
            concat_lines.append(f"file '{frame_file}'")
            concat_lines.append(f"duration {seg_dur:.3f}")
            total_assigned += seg_dur

        if not concat_lines:
            frame_file = tmp_dir / "frame_0000.png"
            render_frame(bg, None, "", episode_title, episode_title, font_body, font_name, font_small).save(
                frame_file, "PNG"
            )
            concat_lines.append(f"file '{frame_file}'")
            concat_lines.append(f"duration {audio_duration:.3f}")
        else:
            # Repeat last frame with enough duration so -t audio_duration clamps cleanly
            last_file = tmp_dir / f"frame_{len(performances) - 1:04d}.png"
            tail_dur = max(1.0, (audio_duration - total_assigned) + 2.0)
            concat_lines.append(f"file '{last_file}'")
            concat_lines.append(f"duration {tail_dur:.3f}")
            concat_lines.append(f"file '{last_file}'")

        concat_path = tmp_dir / "concat.txt"
        concat_path.write_text("\n".join(concat_lines) + "\n", encoding="utf-8")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-i",
            str(audio_path),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "stillimage",
            "-crf",
            "22",
            "-g",
            "150",
            "-r",
            "5",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-t",
            f"{audio_duration:.3f}",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        subprocess.check_call(cmd)

    provenance = {
        "tool": "yawa_visual_novel",
        "source_audio_sha256": sha256_file(audio_path),
        "video_sha256": sha256_file(output_path),
        "width": width,
        "height": height,
        "frames_rendered": len(performances),
        "portraits_used": sorted(used_portraits),
    }
    prov_path = output_path.with_name(f"{output_path.stem}.visual_novel.json")
    prov_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
