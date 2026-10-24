import json
import sys

import librosa
import numpy as np
import soundfile as sf


def measure(path: str, request: dict) -> dict:
    samples, sr = sf.read(path, dtype="float32")
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    hop = request["hop_length"]
    frame = request["frame_length"]
    f0, voiced, _ = librosa.pyin(
        samples,
        fmin=request["fmin_hz"],
        fmax=request["fmax_hz"],
        sr=sr,
        frame_length=frame,
        hop_length=hop,
    )
    rms = librosa.feature.rms(y=samples, frame_length=frame, hop_length=hop)[0]
    count = min(len(f0), len(rms))
    f0, voiced, rms = f0[:count], voiced[:count], rms[:count]
    valid = voiced & np.isfinite(f0)
    reference = np.percentile(rms[valid], request["reference_percentile"])
    relative_db = 20 * np.log10(np.maximum(rms, 1e-10) / reference)
    loud = np.where(valid & (relative_db > request["loud_relative_db"]))[0]
    clip_ratio = float(np.mean(np.abs(samples) > request["clip_threshold"]))
    if len(loud) == 0:
        return {
            "path": path,
            "loud_frames": 0,
            "f0_percentile_hz": None,
            "f0_max_hz": None,
            "jump_events": 0,
            "clip_ratio": clip_ratio,
        }
    pitch = f0[loud]
    window = round(request["jump_window_seconds"] * sr / hop)
    run_id = np.concatenate([[0], np.cumsum(np.diff(loud) != 1)])
    jump = np.zeros(len(loud), dtype=bool)
    for k in range(window, len(loud)):
        if run_id[k] != run_id[k - window]:
            continue
        ratio = pitch[k] / pitch[k - window]
        jump[k] = ratio > request["jump_ratio"] or ratio < 1 / request["jump_ratio"]
    jump_events = int(np.sum(jump[1:] & ~jump[:-1])) + int(jump[0])
    return {
        "path": path,
        "loud_frames": int(len(loud)),
        "f0_percentile_hz": round(float(np.percentile(pitch, request["loud_percentile"])), 1),
        "f0_max_hz": round(float(np.max(pitch)), 1),
        "jump_events": jump_events,
        "clip_ratio": clip_ratio,
    }


def main() -> None:
    request = json.loads(sys.argv[1])
    print(json.dumps([measure(path, request) for path in request["paths"]]))


if __name__ == "__main__":
    main()
