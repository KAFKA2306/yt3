import argparse
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Irodori-TTS through the local ComfyUI API")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--ckpt-name", required=True)
    parser.add_argument("--codec-repo", required=True)
    parser.add_argument("--dtype", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--caption", required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--num-steps", type=int, required=True)
    parser.add_argument("--duration-scale", type=float, default=1.0)
    parser.add_argument("--cfg-scale-caption", type=float, default=3.0)
    parser.add_argument("--ref-wav", type=Path)
    parser.add_argument("--output-wav", type=Path, required=True)
    return parser.parse_args()


def build_graph(args: argparse.Namespace, ref_name: str | None, prefix: str) -> dict:
    graph: dict = {
        "1": {"class_type": "IrodoriCheckpointLoader", "inputs": {"ckpt_name": args.ckpt_name, "codec_repo": args.codec_repo, "device": "cuda", "dtype": args.dtype}},
    }
    speaker_embed = None
    if ref_name is not None:
        graph["4"] = {"class_type": "LoadAudio", "inputs": {"audio": ref_name}}
        graph["3"] = {"class_type": "VAEEncodeAudio", "inputs": {"audio": ["4", 0], "vae": ["1", 1]}}
        graph["13"] = {"class_type": "IrodoriSpeakerEncode", "inputs": {"model": ["1", 0], "ref_latent": ["3", 0]}}
        speaker_embed = ["13", 0]
    text_inputs: dict = {"text": args.text, "speaker_uncond_mode": "mask", "caption": args.caption, "model": ["1", 0]}
    if speaker_embed is not None:
        text_inputs["speaker_embed"] = speaker_embed
    graph.update({
        "2": {"class_type": "IrodoriTextEncode", "inputs": text_inputs},
        "5": {"class_type": "IrodoriCFGGuider", "inputs": {"cfg_min_t": 0.5, "cfg_max_t": 1, "scale_1": args.cfg_scale_caption, "scale_2": 5, "model": ["1", 0], "cond": ["2", 0], "uncond_1": ["2", 1], "uncond_2": ["2", 2]}},
        "7": {"class_type": "RandomNoise", "inputs": {"noise_seed": args.seed}},
        "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "9": {"class_type": "BasicScheduler", "inputs": {"scheduler": "simple", "steps": args.num_steps, "denoise": 1, "model": ["1", 0]}},
        "10": {"class_type": "IrodoriEmptyLatent", "inputs": {"text": args.text, "seconds": 0, "duration_scale": args.duration_scale, "batch_size": 1, "model": ["1", 0], "vae": ["1", 1]}},
        "6": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7", 0], "guider": ["5", 0], "sampler": ["8", 0], "sigmas": ["9", 0], "latent_image": ["10", 0]}},
        "11": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["6", 1], "vae": ["1", 1]}},
        "12": {"class_type": "SaveAudio", "inputs": {"filename_prefix": prefix, "audio": ["11", 0]}},
    })
    return graph


def submit(base_url: str, graph: dict) -> str:
    request = urllib.request.Request(
        f"{base_url}/prompt",
        data=json.dumps({"prompt": graph}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)["prompt_id"]


def wait_for_audio(base_url: str, prompt_id: str) -> dict:
    for _ in range(1200):
        with urllib.request.urlopen(f"{base_url}/history/{prompt_id}", timeout=30) as response:
            history = json.load(response)
        if prompt_id in history:
            entry = history[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI execution failed: {json.dumps(status, ensure_ascii=False)[:800]}")
            for node_output in entry.get("outputs", {}).values():
                for audio in node_output.get("audio", []):
                    return audio
            raise RuntimeError("ComfyUI finished without audio output")
        time.sleep(3)
    raise TimeoutError(f"ComfyUI prompt {prompt_id} did not finish")


def main() -> None:
    args = parse_args()
    ref_name = None
    if args.ref_wav is not None:
        ref_name = f"yawa_ref_{args.ref_wav.stem}.wav"
        shutil.copyfile(args.ref_wav, Path(args.input_dir) / ref_name)
    prefix = f"yawa/{args.output_wav.stem}"
    prompt_id = submit(args.base_url, build_graph(args, ref_name, prefix))
    audio = wait_for_audio(args.base_url, prompt_id)
    source = Path(args.output_dir) / audio["subfolder"] / audio["filename"]
    args.output_wav.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ac", "1", "-ar", "48000", str(args.output_wav)],
        check=True,
    )
    print(json.dumps({"prompt_id": prompt_id, "source": str(source), "output_wav": str(args.output_wav)}, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
