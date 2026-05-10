---
name: research-and-script
description: Skill for integrating research and scriptwriting. Handles Daily Pulse research, NotebookLM operations, Polymarket quantitative analysis, and video scriptwriting.
type: skill
---

# Research And Script

## Objective

Collect high-impact events with numerical data and convert them into analysis and scripts.

## Essential Paths

- Root: `/home/kafka/2511youtuber/v3/yt3`
- Research Output: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/research.md`
- Script Output: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/script_master.md`
- Metadata: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/youtube_metadata.md`
- NotebookLM Config: `/home/kafka/2511youtuber/v3/yt3/config/default.yaml`
- NotebookLM Output: `/home/kafka/2511youtuber/v3/yt3/runs-nlm/`
- Quantitative Analysis Log: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`

## Formatter/Validation

- Format: `bun run format`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- Validation: `bun run verify:scenario`
- API Validation: `bun run verify:api`

## Workflow

1. Collect daily sources and associate numerical data, URLs, and ISO8601 timestamps with each claim.
2. Record only facts in `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/research.md`.
3. Extract market data, calculate `p_model` and `edge`, and determine priorities.
4. Read `config/default.yaml` and retrieve target notebooks using `notebooklm list --json`.
5. Save NotebookLM products to `/home/kafka/2511youtuber/v3/yt3/runs-nlm/`.
6. Select maximum impact facts and convert them into scripts in `script_master.md`.
7. Generate `youtube_metadata.md`.

## Validation
- After generation, `script_master.md` and `youtube_metadata.md` must be validated to ensure they do not contain any metadata artifacts like file paths, `.wav` filenames, or other internal identifiers (e.g., `part_001`). This is a critical quality gate.

## Integration

- After creating the script and metadata, pass the same `runs/YYYY-MM-DD/<project_id>/` to the next step.
- Ensure `research.md` is complete before proceeding. Do not move forward if URLs, numbers, or timestamps are missing.
- When both `script_master.md` and `youtube_metadata.md` are ready, pass them to `audio-production`.
