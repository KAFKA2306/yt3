#!/usr/bin/env python3
"""Oneshot single-load batch TTS runner for Yawa Archive (Irodori-TTS-v4.1).

Loads the checkpoint & DACVAE codec ONCE, synthesizes all pending lines in the
episode (using Ampere bf16 on CUDA + context KV cache), writes 48kHz mono PCM
WAVs + pause WAVs directly, and exits immediately to release 100% GPU VRAM.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, os.getcwd())

import torch
import torchaudio
from irodori_tts.inference_runtime import (
    InferenceRuntime,
    RuntimeKey,
    SamplingRequest,
    download_hf_checkpoint,
    resolve_cfg_scales,
    save_wav,
)


def write_silence_48k_mono(target: Path, seconds: float) -> None:
    if target.exists() and target.stat().st_size > 44:
        return
    num_frames = max(1, int(round(seconds * 48000)))
    tmp = target.with_suffix(f".{os.getpid()}.tmp.wav")
    try:
        with wave.open(str(tmp), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(48000)
            wf.writeframes(b"\x00\x00" * num_frames)
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def write_48k_mono_pcm(audio: torch.Tensor, sample_rate: int, target: Path) -> None:
    tmp_raw = target.with_suffix(f".{os.getpid()}.raw.wav")
    tmp_norm = target.with_suffix(f".{os.getpid()}.norm.wav")
    try:
        if audio.ndim == 1:
            wav = audio.unsqueeze(0)
        elif audio.ndim == 2:
            wav = audio.mean(dim=0, keepdim=True) if audio.shape[0] > 1 else audio
        else:
            wav = audio.reshape(1, -1)
        wav = wav.detach().to(device="cpu", dtype=torch.float32)
        if sample_rate != 48000:
            wav = torchaudio.functional.resample(wav, sample_rate, 48000)
        pcm = (wav.clamp(-1.0, 1.0) * 32767.0).to(torch.int16).squeeze(0).numpy().tobytes()
        with wave.open(str(tmp_norm), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(48000)
            wf.writeframes(pcm)
        os.replace(tmp_norm, target)
    except Exception:
        # Fallback through save_wav + ffmpeg if tensor shape differs
        save_wav(str(tmp_raw), audio, sample_rate)
        subprocess.check_call(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(tmp_raw),
                "-ar",
                "48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(tmp_norm),
            ]
        )
        os.replace(tmp_norm, target)
    finally:
        if tmp_raw.exists():
            tmp_raw.unlink(missing_ok=True)
        if tmp_norm.exists():
            tmp_norm.unlink(missing_ok=True)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: yawa_tts_batch.py <manifest.json>")
    manifest_path = Path(sys.argv[1])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # First write any needed pause silences directly (0.1ms each, 0 ffmpeg spawns)
    for pause_item in manifest.get("pauses", []):
        write_silence_48k_mono(Path(pause_item["output_wav"]), float(pause_item["seconds"]))

    items = manifest.get("items", [])
    pending = [
        it for it in items if not (Path(it["output_wav"]).exists() and Path(it["output_wav"]).stat().st_size > 44)
    ]
    if not pending:
        print("[yawa-tts-batch] all lines already cached; skipping model load", flush=True)
        return

    device = str(manifest["device"])
    use_bf16 = device == "cuda" and torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    precision = "bf16" if use_bf16 else "fp32"

    t_load = time.time()
    checkpoint_path = download_hf_checkpoint(str(manifest["hf_checkpoint"]))
    runtime = InferenceRuntime.from_key(
        RuntimeKey(
            checkpoint=checkpoint_path,
            model_device=device,
            codec_repo=str(manifest["codec_repo"]),
            model_precision=precision,
            codec_device=device,
            codec_precision="fp32",
            codec_deterministic_encode=True,
            codec_deterministic_decode=True,
            compile_model=False,
            compile_dynamic=False,
        )
    )
    print(
        f"[yawa-tts-batch] loaded model once ({device}/{precision}) in {time.time() - t_load:.2f}s for {len(pending)}/{len(items)} line(s)",
        flush=True,
    )

    num_steps = int(manifest.get("num_steps", 40))
    t_gen = time.time()
    for idx, item in enumerate(pending, start=1):
        out_path = Path(item["output_wav"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        ref_wav = item.get("reference_wav")
        no_ref = not bool(ref_wav)
        caption = item.get("caption")
        use_speaker = bool(runtime.model_cfg.use_speaker_condition_resolved and not no_ref)
        cfg_text, cfg_caption, cfg_speaker, _ = resolve_cfg_scales(
            cfg_guidance_mode="independent",
            cfg_scale_text=3.0,
            cfg_scale_caption=3.0,
            cfg_scale_speaker=5.0,
            cfg_scale=None,
            use_caption_condition=bool(
                runtime.model_cfg.use_caption_condition and caption is not None and str(caption).strip() != ""
            ),
            use_speaker_condition=use_speaker,
        )
        req = SamplingRequest(
            text=str(item["text"]),
            caption=None if caption is None else str(caption),
            ref_wav=None,
            ref_wavs=[str(ref_wav)] if ref_wav else None,
            ref_latent=None,
            ref_latents=None,
            ref_embed=None,
            no_ref=no_ref,
            ref_normalize_db=-16.0,
            ref_ensure_max=True,
            num_candidates=1,
            decode_mode="sequential",
            seconds=None,
            duration_scale=float(item.get("duration_scale") or 1.0),
            max_ref_seconds=None,
            max_text_len=None,
            max_caption_len=None,
            num_steps=num_steps,
            cfg_scale_text=cfg_text,
            cfg_scale_caption=cfg_caption,
            cfg_scale_speaker=cfg_speaker,
            cfg_guidance_mode="independent",
            cfg_scale=None,
            cfg_min_t=0.5,
            cfg_max_t=1.0,
            truncation_factor=None,
            rescale_k=None,
            rescale_sigma=None,
            context_kv_cache=True,
            speaker_kv_scale=None,
            speaker_kv_min_t=None,
            speaker_kv_max_layers=None,
            speaker_uncond_mode="mask",
            seed=None,
            t_schedule_mode="linear",
            sway_coeff=-1.0,
            trim_tail=True,
            tail_window_size=20,
            tail_std_threshold=0.05,
            tail_mean_threshold=-0.1,
            lora_adapter=None,
        )
        result = runtime.synthesize(req, log_fn=None)
        write_48k_mono_pcm(result.audio, result.sample_rate, out_path)
        if idx % 10 == 0 or idx == len(pending):
            print(
                f"[yawa-tts-batch] progress {idx}/{len(pending)} ({time.time() - t_gen:.1f}s)",
                flush=True,
            )


if __name__ == "__main__":
    main()
