---
name: publish-operations
description: Skill for managing publishing processes and channel auditing. Handles inventory via YouTube Data API, metadata correction, visibility settings, branding compliance, and Yawa Archive ASMR private/public workflows.
type: skill
---

# Publish Operations

## Objective

Maintain the brand quality of "Yawa Archive" and accurately execute video publishing and inventory management using the YouTube Data API.

For Yawa Archive ASMR, keep uploads private by default, verify the channel identity first, and correct metadata from measured runtime data only.

## Essential Paths

- Environment Variables: `/home/kafka/2511youtuber/v3/yt3/config/.env.yawa` (ASMR specific)
- Execution Directory: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`
- Metadata: `runs/YYYY-MM-DD/<project_id>/youtube_metadata.md`
- Publish Log: `runs/YYYY-MM-DD/<project_id>/publish/output.yaml`
- Standard Workflow: `/home/kafka/2511youtuber/v3/yt3/docs/standard/asmr-workflow.md`

## YouTube API Operation Guide

Combine and execute the following APIs for editing or inventory management.

### 1. Retrieval (List)
- `youtube.videos.list`: Retrieve `snippet`, `status`, and `contentDetails` for a specific `id`.
- `youtube.channels.list`: Use `mine: true` to retrieve the current channel name and `uploads` playlist ID.
- `youtube.playlistItems.list`: List all posted video IDs from the `uploads` playlist.

### 2. Editing/Settings Modification (Update)
- `youtube.videos.update`:
    - `status.privacyStatus`: Toggle between 'public' and 'private'.
    - `snippet`: Batch update title, description, tags, and category.
- **Note**: Always include the update target (`snippet`, `status`, etc.) in the `part` parameter when updating via API.

## Workflow

1. **Pre-verification**: Confirm the existence of `final_video.mp4` and compliance of metadata with `ADR-0015` (Facility names) and `ADR-0020` (Kafka-style Japanese).
2. **Posting**: Execute `task publish:yawa`. Videos are initially posted as `private` by default.
3. **Audit**: Call `videos.list` to retrieve the actual duration (`contentDetails.duration`) of the posted video.
4. **Metadata Correction**:
    - Correct "minutes/seconds" in the title and description based on the actual measured duration.
    - If the title is a placeholder like `ASMR Archive`, correct it immediately.
5. **Deduplication**: If multiple videos with identical content exist, use `videos.update` to revert older or lower-quality ones to `private`.
6. **Publicizing**: After confirming content perfection, change to `public` using `task publicize:yawa RUN_ID=...`.

## Yawa Archive Rules

- Use `ENV_FILE=config/.env.yawa` for all Yawa Archive ASMR publish operations.
- Confirm `channels.list({ mine: true })` before any update.
- Keep `privacyStatus` as `private` until QA and audit pass.
- Use `videos.update` for metadata fixes and dedup privatization.
- Never call `videos.delete`.
- If title or description mentions duration, replace estimates with API-measured values.

## Prohibitions

- Never use `videos.delete`. Handle unnecessary videos by setting them to `private`.
- Do not include "estimated" playtimes in the title. Always use actual measured values (`PTxxMxxS`) obtained from the API.
- Do not update without verifying that the channel name is `Yawa Archive ASMR` via `channels.list`.
