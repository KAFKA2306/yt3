---
name: local-llm-orchestration
description: Manage local LLM (vLLM + Qwen3.5-9B) as Tier 2 fallback when Gemini quotas are exhausted. Use when configuring vLLM, debugging 429 fallback behavior, hitting the 4096 token limit, or verifying VRAM capacity before loading a model. Triggers on "local model", "vLLM", "Qwen", "fallback", "VRAM", or "4096 trap".
---

# Local LLM Orchestration

## Physical Budget

FP16/BF16 dense models require ~2GB VRAM per 1B parameters plus KV cache overhead.

```bash
nvidia-smi   # check available VRAM
```

If `(model_size_GiB + 2) > total_vram_GiB`, the load will fail. Use 4-bit quantization (AWQ/GPTQ) when VRAM is under 16GB.

## Startup Verification

Monitor `logs/vllm.log` during initialization. If `Model loading took X GiB` exceeds VRAM:

```bash
task vllm:down
```

Then switch back to Gemini Tier 1 — do not attempt workarounds.

## Context Constraints (The 4096 Trap)

Local models have a hard 4096 token context window. Mitigations:
- Cap `max_tokens` at 2048 to preserve space for KV cache
- Strip `<think>...</think>` tags before parsing: `/<think>[\s\S]*?<\/think>/g`
- Assign only short-form tasks (research, audit, classification) — never long-form script generation

## Task Assignment

| Task Type | Local (≤12GB VRAM) | Cloud |
|-----------|-------------------|-------|
| Research / fact extraction | ✓ | ✓ |
| Evaluation / scoring | ✓ | ✓ |
| Script generation (>1000 tokens) | ✗ | ✓ |
| Multi-source simultaneous ingestion | ✗ | ✓ |
