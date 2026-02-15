---
description: run the daily production pipeline, or resume a failed run
---
# Production Run / Resume

## Fresh Run
// turbo
1. Start services:
```bash
task up
```
// turbo
2. Execute full pipeline:
```bash
task run
```
3. Monitor progress in `logs/agent_activity.jsonl`.

## Resume a Failed Run
1. Identify the failed `RUN_ID` (usually today's date `YYYY-MM-DD`). Check `logs/agent_activity.jsonl` for the failed stage.
2. If the failure was in `MEDIA`, delete partial output to avoid ffmpeg conflicts:
```bash
rm -rf runs/[RUN_ID]/media
```
3. Resume. The "Smart Resume" logic skips completed stages automatically:
// turbo
```bash
RUN_ID=[RUN_ID] npx tsx src/index.ts
```
4. If hitting 429 rate limits, wait and retry. Do NOT switch away from **Gemini 3 Flash** without explicit user permission.
