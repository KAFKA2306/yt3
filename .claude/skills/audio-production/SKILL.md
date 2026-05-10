---
name: audio-production
description: Integrated skill for consistent production of Japanese audio content. Handles script normalization, TTS generation, ASR reverse validation, damage correction, and final mixing.
type: skill
---

# Audio Production

## Objective

Reproducibly execute production of Japanese TTS/ASMR audio while maintaining semantic fidelity.

## Essential Paths

- Root: `/home/kafka/2511youtuber/v3/yt3`
- Execution Directory: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`
- Script: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/script_master.md`
- Generated Parts: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/parts/`
- ASR Validation: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/asr_quality/`
- Final Audio: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/final_mix.wav`

## Formatter/Validation

- Markdown Formatting: `bun run format`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- Final Diagnosis: `task harness:doctor`

## Workflow

1. Create `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/script_master.md`.
2. Segment the script into chapters and output to `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/parts/`.
3. Generate audio for each chapter using TTS.
4. Validate generated audio using ASR and record in `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/asr_quality/`.
5. Fix script and regenerate only for CRITICAL/HIGH damage.
6. Concatenate all chapters with `ffmpeg` to generate `final_mix.wav`.
7. Keep result paths fixed and overwrite in the same directory upon rerun.

## Video Integration

- After creating `final_mix.wav`, ensure `thumbnail.png` exists in the same run directory.
- If the image has been replaced, always execute `task asmr:video DIR=/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>` to regenerate `final_video.mp4`.
- Do not stop at `final_mix.wav`. The final artifact for YouTube must include `final_video.mp4`.
- Do not consider the task complete until `final_video.mp4` exists.
