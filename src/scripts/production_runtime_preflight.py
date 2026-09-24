#!/usr/bin/env python3
"""Validate the Python runtime used by YT3 production audio audits.

The setup mode is intentionally side-effect limited: it checks imports and the
repository-owned cache boundary without downloading a model. Full mode also
initializes the production SpeechBrain encoder, proving that the configured
model can be read or fetched using the same cache policy as production.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


MODEL_ID = "speechbrain/spkrec-ecapa-voxceleb"
REQUIRED_MODULES = (
    "huggingface_hub",
    "librosa",
    "numpy",
    "pydantic",
    "yaml",
    "requests",
    "speechbrain",
    "torch",
)


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def cache_root(root: Path) -> Path:
    return Path(os.environ.get("YT3_HF_CACHE", root / "data" / "cache" / "huggingface"))


def configure_cache(root: Path) -> Path:
    cache = cache_root(root)
    hub = cache / "hub"
    cache.mkdir(parents=True, exist_ok=True)
    hub.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(cache)
    os.environ["HF_HUB_CACHE"] = str(hub)
    os.environ["HF_TOKEN_PATH"] = str(cache / "token")
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    return cache


def check_imports() -> dict[str, Any]:
    failures: dict[str, str] = {}
    for module in REQUIRED_MODULES:
        try:
            importlib.import_module(module)
        except Exception as exc:  # pragma: no cover - exact dependency errors vary by platform
            failures[module] = f"{type(exc).__name__}: {exc}"
    return {
        "status": "PASS" if not failures else "FAIL",
        "details": "all production audit imports are available"
        if not failures
        else "production audit imports are missing",
        "failures": failures,
    }


def check_cache(cache: Path) -> dict[str, Any]:
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", prefix="yt3-preflight-", dir=cache, delete=False
        ) as handle:
            probe = Path(handle.name)
            handle.write("yt3-cache-write-probe")
        probe.unlink()
        return {
            "status": "PASS",
            "details": "repository-owned Hugging Face cache is readable and writable",
            "path": str(cache),
        }
    except Exception as exc:
        return {
            "status": "FAIL",
            "details": f"Hugging Face cache is not writable: {type(exc).__name__}: {exc}",
            "path": str(cache),
        }


def check_model(cache: Path) -> dict[str, Any]:
    try:
        from speechbrain.inference.speaker import EncoderClassifier

        model_dir = cache / "speechbrain" / "spkrec-ecapa-voxceleb"
        EncoderClassifier.from_hparams(source=MODEL_ID, savedir=str(model_dir))
        return {
            "status": "PASS",
            "details": "SpeechBrain encoder initialized from the production cache policy",
            "model": MODEL_ID,
            "path": str(model_dir),
        }
    except Exception as exc:  # pragma: no cover - provider/cache failures are environment-specific
        return {
            "status": "FAIL",
            "details": f"SpeechBrain encoder initialization failed: {type(exc).__name__}: {exc}",
            "model": MODEL_ID,
            "path": str(cache / "speechbrain" / "spkrec-ecapa-voxceleb"),
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("setup", "full"), default="setup")
    args = parser.parse_args()

    root = repository_root()
    cache = configure_cache(root)
    checks: dict[str, Any] = {
        "python": {"status": "PASS", "details": sys.version.split()[0]},
        "imports": check_imports(),
        "cache": check_cache(cache),
    }
    if args.mode == "full" and checks["imports"]["status"] == "PASS":
        checks["model"] = check_model(cache)

    statuses = [check["status"] for check in checks.values()]
    status = "FAIL" if "FAIL" in statuses else "PASS"
    report = {
        "schema_version": "yt3_python_runtime_preflight_v1",
        "mode": args.mode,
        "status": status,
        "cache": str(cache),
        "checks": checks,
    }
    print(json.dumps(report, ensure_ascii=False))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
