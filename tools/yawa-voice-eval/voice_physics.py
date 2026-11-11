#!/usr/bin/env python3
"""Offline acoustic measurements and reference-group similarity scoring."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import parselmouth
import soundfile as sf

VERSION = "1.0.1"
PITCH_FLOOR_HZ = 100.0
PITCH_TOP_HZ = 800.0
PITCH_STEP_S = 0.01
PITCH_REFERENCE_HZ = 220.0
FRAME_S = 0.04
HOP_S = 0.01
FEATURE_SCALES = {
    "f0_median_semitone": 3.0,
    "f0_p95_p05_semitone": 4.0,
    "f0_change_median_semitone_s": 6.0,
    "hnr_median_db": 6.0,
    "spectral_tilt_db_octave": 4.0,
    "rms_p90_p10_db": 6.0,
    "low_energy_frame_rate": 0.15,
    "high_frequency_energy_ratio_db": 6.0,
}
MANIFEST_FIELDS = (
    "sample_id",
    "group",
    "performer_id",
    "performer_name",
    "character_id",
    "line_id",
    "performance_id",
    "audio_path",
    "source_url",
    "rights_note",
    "vowel_intervals_csv",
)


class EvaluationError(Exception):
    pass


def _load_audio(path: Path) -> tuple[np.ndarray, int]:
    if not path.is_file():
        raise EvaluationError(f"audio file not found: {path}")
    samples, sample_rate = sf.read(path, dtype="float64", always_2d=True)
    if samples.size == 0 or sample_rate < 16000:
        raise EvaluationError(f"empty audio or sample rate below 16 kHz: {path}")
    mono = np.mean(samples, axis=1)
    if not np.all(np.isfinite(mono)):
        raise EvaluationError(f"audio contains NaN or infinite samples: {path}")
    peak = float(np.max(np.abs(mono)))
    if peak == 0.0:
        raise EvaluationError(f"audio is silent: {path}")
    return mono, int(sample_rate)


def _frame_arrays(samples: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    frame_length = max(1, round(FRAME_S * sample_rate))
    hop_length = max(1, round(HOP_S * sample_rate))
    if len(samples) < frame_length:
        raise EvaluationError("audio is shorter than one analysis frame")
    starts = np.arange(0, len(samples) - frame_length + 1, hop_length)
    window = np.hanning(frame_length)
    frequencies = np.fft.rfftfreq(frame_length, 1.0 / sample_rate)
    rms_values: list[float] = []
    tilts: list[float] = []
    hf_ratios: list[float] = []
    lower = (frequencies >= 300.0) & (frequencies <= min(4000.0, sample_rate / 2))
    low_band = (frequencies >= 500.0) & (frequencies < min(4000.0, sample_rate / 2))
    high_band = (frequencies >= 4000.0) & (frequencies <= min(10000.0, sample_rate / 2))
    if np.count_nonzero(lower) < 3 or not np.any(low_band) or not np.any(high_band):
        raise EvaluationError("sample rate does not cover required spectral bands")
    log_frequencies = np.log2(frequencies[lower])

    # Bounded batches keep peak memory stable on long-form episodes.
    for offset in range(0, len(starts), 512):
        batch_starts = starts[offset : offset + 512]
        frames = np.stack([samples[i : i + frame_length] for i in batch_starts])
        rms = np.sqrt(np.mean(frames * frames, axis=1))
        rms_values.extend(rms.tolist())
        power = np.abs(np.fft.rfft(frames * window, axis=1)) ** 2
        db = 10.0 * np.log10(np.maximum(power, 1e-20))
        spectral_db = db[:, lower]
        centered_x = log_frequencies - float(np.mean(log_frequencies))
        centered_y = spectral_db - np.mean(spectral_db, axis=1, keepdims=True)
        slopes = np.sum(centered_y * centered_x, axis=1) / np.sum(centered_x * centered_x)
        tilts.extend(slopes.tolist())
        low_power = np.sum(power[:, low_band], axis=1)
        high_power = np.sum(power[:, high_band], axis=1)
        ratios = 10.0 * np.log10(np.maximum(high_power, 1e-20) / np.maximum(low_power, 1e-20))
        hf_ratios.extend(ratios.tolist())
    return np.asarray(rms_values), np.asarray(tilts), np.asarray(hf_ratios)


def _vowel_features(
    sound: parselmouth.Sound,
    intervals_csv: Path | None,
    pitch_times: np.ndarray,
    pitch_values: np.ndarray,
) -> dict[str, Any]:
    empty = {
        "f1_median_hz": None,
        "f1_bandwidth_median_hz": None,
        "f2_median_hz": None,
        "f3_median_hz": None,
        "a1_p0_median_db": None,
        "a1_p0_note": "manual vowel intervals required; values are withheld when median vowel F0 is 250 Hz or higher",
        "vowel_intervals_used": 0,
    }
    if intervals_csv is None:
        return empty
    if not intervals_csv.is_file():
        raise EvaluationError(f"vowel interval CSV not found: {intervals_csv}")
    with intervals_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        expected = {"start_seconds", "end_seconds", "vowel"}
        if not expected.issubset(reader.fieldnames or []):
            raise EvaluationError(
                f"{intervals_csv} needs columns start_seconds,end_seconds,vowel"
            )
        rows = list(reader)
    formants = parselmouth.praat.call(
        sound, "To Formant (burg)...", 0.0, 5.0, 5500.0, 0.025, 50.0
    )
    f1: list[float] = []
    b1: list[float] = []
    f2: list[float] = []
    f3: list[float] = []
    a1_p0: list[float] = []
    for row_number, row in enumerate(rows, start=2):
        try:
            start = float(row["start_seconds"])
            end = float(row["end_seconds"])
        except (TypeError, ValueError) as exc:
            raise EvaluationError(f"invalid vowel interval at row {row_number}") from exc
        if start < 0 or end <= start or end > sound.get_total_duration():
            raise EvaluationError(f"out-of-range vowel interval at row {row_number}")
        if not row.get("vowel", "").strip():
            raise EvaluationError(f"missing vowel label at row {row_number}")
        times = np.linspace(start + (end - start) * 0.25, end - (end - start) * 0.25, 3)
        for time in times:
            values = [float(formants.get_value_at_time(i, float(time))) for i in (1, 2, 3)]
            bandwidth = float(formants.get_bandwidth_at_time(1, float(time)))
            if all(math.isfinite(value) and value > 0 for value in values) and math.isfinite(bandwidth):
                f1.append(values[0])
                f2.append(values[1])
                f3.append(values[2])
                b1.append(bandwidth)
        pitch_in_interval = pitch_values[
            (pitch_times >= start) & (pitch_times <= end) & np.isfinite(pitch_values) & (pitch_values > 0)
        ]
        # At high F0 the low-frequency nasal peak P0 cannot be separated reliably
        # from the fundamental, so a manually supplied A1-P0 value is withheld.
        if row.get("a1_p0_db", "").strip() and pitch_in_interval.size and float(np.median(pitch_in_interval)) < 250.0:
            try:
                value = float(row["a1_p0_db"])
            except ValueError as exc:
                raise EvaluationError(f"invalid a1_p0_db at row {row_number}") from exc
            if math.isfinite(value):
                a1_p0.append(value)
    return {
        "f1_median_hz": float(np.median(f1)) if f1 else None,
        "f1_bandwidth_median_hz": float(np.median(b1)) if b1 else None,
        "f2_median_hz": float(np.median(f2)) if f2 else None,
        "f3_median_hz": float(np.median(f3)) if f3 else None,
        "a1_p0_median_db": float(np.median(a1_p0)) if a1_p0 else None,
        "a1_p0_note": "manual values omitted when median vowel F0 is 250 Hz or higher",
        "vowel_intervals_used": len(rows),
    }


def extract_features(audio_path: Path, intervals_csv: Path | None = None) -> dict[str, Any]:
    samples, sample_rate = _load_audio(audio_path)
    sound = parselmouth.Sound(samples, sampling_frequency=sample_rate)
    pitch = sound.to_pitch_ac(
        time_step=PITCH_STEP_S,
        pitch_floor=PITCH_FLOOR_HZ,
        max_number_of_candidates=15,
        very_accurate=False,
        silence_threshold=0.09,
        voicing_threshold=0.50,
        octave_cost=0.055,
        octave_jump_cost=0.35,
        voiced_unvoiced_cost=0.14,
        pitch_ceiling=PITCH_TOP_HZ,
    )
    pitch_values = np.asarray(pitch.selected_array["frequency"], dtype=float)
    pitch_times = np.asarray(pitch.xs(), dtype=float)
    voiced_mask = np.isfinite(pitch_values) & (pitch_values >= PITCH_FLOOR_HZ)
    voiced = pitch_values[voiced_mask]
    if voiced.size < 3:
        raise EvaluationError("fewer than three voiced F0 frames were detected")
    semitones = 12.0 * np.log2(voiced / PITCH_REFERENCE_HZ)
    all_semitones = np.full_like(pitch_values, np.nan, dtype=float)
    all_semitones[voiced_mask] = 12.0 * np.log2(voiced / PITCH_REFERENCE_HZ)
    adjacent = voiced_mask[1:] & voiced_mask[:-1]
    dt = np.diff(pitch_times)[adjacent]
    d_st = np.diff(all_semitones)[adjacent]
    change_rate = np.abs(d_st / dt) if dt.size else np.asarray([])
    harmonicity = sound.to_harmonicity_cc(
        time_step=0.01, minimum_pitch=PITCH_FLOOR_HZ, silence_threshold=0.1, periods_per_window=1.0
    )
    hnr = np.asarray(harmonicity.values, dtype=float).reshape(-1)
    hnr = hnr[np.isfinite(hnr)]
    if not hnr.size:
        raise EvaluationError("HNR analysis returned no finite frames")
    rms, tilt, hf_ratio = _frame_arrays(samples, sample_rate)
    rms_db = 20.0 * np.log10(np.maximum(rms, 1e-12))
    low_energy_rate = float(np.mean(rms_db < float(np.max(rms_db)) - 35.0))
    clipping_rate = float(np.mean(np.abs(samples) >= 0.999))
    leading = _edge_silence_seconds(samples, sample_rate, from_end=False)
    trailing = _edge_silence_seconds(samples, sample_rate, from_end=True)
    return {
        "audio_seconds": float(len(samples) / sample_rate),
        "sample_rate_hz": sample_rate,
        "f0_median_hz": float(np.median(voiced)),
        "f0_p05_hz": float(np.percentile(voiced, 5)),
        "f0_p95_hz": float(np.percentile(voiced, 95)),
        "f0_median_semitone": float(np.median(semitones)),
        "f0_p95_p05_semitone": float(np.percentile(semitones, 95) - np.percentile(semitones, 5)),
        "f0_change_median_semitone_s": float(np.median(change_rate)) if change_rate.size else None,
        "voiced_ratio": float(np.mean(voiced_mask)),
        "hnr_median_db": float(np.median(hnr)),
        "spectral_tilt_db_octave": float(np.median(tilt)),
        "rms_p90_p10_db": float(np.percentile(rms_db, 90) - np.percentile(rms_db, 10)),
        "low_energy_frame_rate": low_energy_rate,
        "high_frequency_energy_ratio_db": float(np.median(hf_ratio)),
        "clipping_rate": clipping_rate,
        "dc_offset": float(np.mean(samples)),
        "leading_silence_seconds": leading,
        "trailing_silence_seconds": trailing,
        **_vowel_features(sound, intervals_csv, pitch_times, pitch_values),
        "analysis": {
            "tool": "Praat via Parselmouth",
            "pitch_method": "Parselmouth Sound.to_pitch_ac",
            "pitch_floor_hz": PITCH_FLOOR_HZ,
            "pitch_top_hz": PITCH_TOP_HZ,
            "pitch_step_s": PITCH_STEP_S,
            "pitch_reference_hz": PITCH_REFERENCE_HZ,
            "spectral_tilt_band_hz": [300, min(4000, sample_rate // 2)],
            "low_energy_threshold_db_below_peak": 35.0,
            "high_frequency_bands_hz": [[500, 4000], [4000, min(10000, sample_rate // 2)]],
        },
    }


def _edge_silence_seconds(samples: np.ndarray, sample_rate: int, from_end: bool) -> float:
    frame_length = max(1, round(0.02 * sample_rate))
    count = len(samples) // frame_length
    frames = samples[: count * frame_length].reshape(count, frame_length)
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    db = 20.0 * np.log10(np.maximum(rms, 1e-12))
    order = db[::-1] if from_end else db
    quiet = 0
    for level in order:
        if level >= -50.0:
            break
        quiet += 1
    return float(quiet * frame_length / sample_rate)


def _load_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise EvaluationError(f"manifest not found: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not set(MANIFEST_FIELDS).issubset(reader.fieldnames or []):
            raise EvaluationError("manifest headers do not match the v1 schema")
        rows = list(reader)
    if not rows:
        raise EvaluationError("manifest contains no rows")
    seen: set[str] = set()
    for row_number, row in enumerate(rows, start=2):
        for field in ("sample_id", "group", "performer_id", "performer_name", "character_id", "line_id", "performance_id", "audio_path", "rights_note"):
            if not row.get(field, "").strip():
                raise EvaluationError(f"manifest row {row_number} is missing {field}")
        if row["group"] not in {"center", "range"}:
            raise EvaluationError(f"manifest row {row_number} group must be center or range")
        if row["sample_id"] in seen:
            raise EvaluationError(f"duplicate sample_id: {row['sample_id']}")
        seen.add(row["sample_id"])
        audio_path = Path(row["audio_path"])
        row["_audio_path"] = audio_path if audio_path.is_absolute() else path.parent / audio_path
        intervals = row.get("vowel_intervals_csv", "").strip()
        interval_path = Path(intervals) if intervals else None
        row["_intervals_path"] = (
            interval_path if interval_path is None or interval_path.is_absolute() else path.parent / interval_path
        )
    return rows


def _distance(left: dict[str, Any], right: dict[str, Any]) -> float:
    total = 0.0
    for feature, scale in FEATURE_SCALES.items():
        a = left.get(feature)
        b = right.get(feature)
        if a is None or b is None or not math.isfinite(float(a)) or not math.isfinite(float(b)):
            raise EvaluationError(f"missing/non-finite model feature: {feature}")
        total += ((float(a) - float(b)) / scale) ** 2
    return math.sqrt(total / len(FEATURE_SCALES))


def build_model(manifest_path: Path, output_path: Path) -> dict[str, Any]:
    rows = _load_manifest(manifest_path)
    feature_rows: list[dict[str, Any]] = []
    model_groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        features = extract_features(row["_audio_path"], row["_intervals_path"])
        feature_row = {key: value for key, value in row.items() if not key.startswith("_")}
        feature_row["features"] = features
        feature_rows.append(feature_row)
    for group in ("center", "range"):
        group_rows = [row for row in feature_rows if row["group"] == group]
        performers = sorted({row["performer_id"] for row in group_rows})
        if not group_rows:
            continue
        if len(performers) < 2:
            raise EvaluationError(f"group '{group}' needs references from at least two performers")
        performer_nn: list[float] = []
        for performer in performers:
            own = [row for row in group_rows if row["performer_id"] == performer]
            other = [row for row in group_rows if row["performer_id"] != performer]
            distances = [min(_distance(row["features"], candidate["features"]) for candidate in other) for row in own]
            performer_nn.append(float(np.median(distances)))
        d50 = float(np.median(performer_nn))
        if not math.isfinite(d50) or d50 <= 0:
            raise EvaluationError(f"group '{group}' has zero/invalid calibration distance")
        model_groups[group] = {
            "performer_count": len(performers),
            "sample_count": len(group_rows),
            "d50": d50,
            "references": [
                {
                    "sample_id": row["sample_id"],
                    "performer_id": row["performer_id"],
                    "performer_name": row["performer_name"],
                    "character_id": row["character_id"],
                    "line_id": row["line_id"],
                    "performance_id": row["performance_id"],
                    "features": {name: row["features"].get(name) for name in FEATURE_SCALES},
                }
                for row in group_rows
            ],
        }
    if "center" not in model_groups:
        raise EvaluationError("the center group needs at least two performers with audio")
    model = {
        "schema_version": 1,
        "evaluator_version": VERSION,
        "built_at_utc": datetime.now(timezone.utc).isoformat(),
        "feature_scales": FEATURE_SCALES,
        "similarity_formula": "100 * exp(-ln(2) * (d_min / d50)^2)",
        "groups": model_groups,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(model, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    feature_csv = output_path.with_name("reference_features.csv")
    with feature_csv.open("w", encoding="utf-8", newline="") as handle:
        fields = ["sample_id", "group", "performer_id", "performer_name", *FEATURE_SCALES]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in feature_rows:
            writer.writerow({**{k: row.get(k) for k in fields[:4]}, **{k: row["features"].get(k) for k in FEATURE_SCALES}})
    return model


def score_audio(audio_path: Path, model_path: Path, intervals_csv: Path | None) -> dict[str, Any]:
    if not model_path.is_file():
        raise EvaluationError(f"reference model not found: {model_path}")
    model = json.loads(model_path.read_text(encoding="utf-8"))
    if model.get("schema_version") != 1:
        raise EvaluationError("unsupported reference model schema")
    features = extract_features(audio_path, intervals_csv)
    scores: dict[str, Any] = {}
    for group, group_model in model.get("groups", {}).items():
        references = group_model.get("references", [])
        if not references:
            raise EvaluationError(f"reference group '{group}' has no samples")
        per_performer: dict[str, tuple[float, dict[str, Any]]] = {}
        for reference in references:
            distance = _distance(features, reference["features"])
            performer = reference["performer_id"]
            previous = per_performer.get(performer)
            if previous is None or distance < previous[0]:
                per_performer[performer] = (distance, reference)
        distance, nearest = min(per_performer.values(), key=lambda item: item[0])
        d50 = float(group_model["d50"])
        similarity = 100.0 * math.exp(-math.log(2.0) * (distance / d50) ** 2)
        scores[group] = {
            "acoustic_similarity_0_100": similarity,
            "nearest_distance": distance,
            "d50": d50,
            "nearest_performer_id": nearest["performer_id"],
            "nearest_sample_id": nearest["sample_id"],
            "interpretation": "reference-group acoustic proximity; not a learned preference probability",
        }
    return {
        "schema_version": 1,
        "evaluator_version": VERSION,
        "audio_path": str(audio_path),
        "features": features,
        "reference_similarity": scores,
        "preference_prediction": None,
        "preference_note": "Collect blinded owner ratings first; do not interpret acoustic similarity as liking.",
    }


def _write_json(value: dict[str, Any], output_path: Path | None) -> None:
    encoded = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    extract_parser = subparsers.add_parser("extract", help="extract acoustic measurements from one WAV")
    extract_parser.add_argument("audio", type=Path)
    extract_parser.add_argument("--vowel-intervals", type=Path)
    extract_parser.add_argument("--output", type=Path)
    build_parser = subparsers.add_parser("build", help="build a center/range model from a CSV manifest")
    build_parser.add_argument("manifest", type=Path)
    build_parser.add_argument(
        "--output", type=Path, default=Path("runs/yawa_voice_lab/reference_model.json")
    )
    score_parser = subparsers.add_parser("score", help="score one WAV against a built reference model")
    score_parser.add_argument("audio", type=Path)
    score_parser.add_argument(
        "--model", type=Path, default=Path("runs/yawa_voice_lab/reference_model.json")
    )
    score_parser.add_argument("--vowel-intervals", type=Path)
    score_parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "extract":
            result = {
                "schema_version": 1,
                "evaluator_version": VERSION,
                "audio_path": str(args.audio),
                "features": extract_features(args.audio, args.vowel_intervals),
            }
            _write_json(result, args.output)
        elif args.command == "build":
            result = build_model(args.manifest, args.output)
            print(json.dumps({"status": "MODEL_BUILT", "output": str(args.output), "groups": sorted(result["groups"])}, ensure_ascii=False))
        elif args.command == "score":
            result = score_audio(args.audio, args.model, args.vowel_intervals)
            _write_json(result, args.output)
        else:
            raise EvaluationError(f"unknown command: {args.command}")
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
