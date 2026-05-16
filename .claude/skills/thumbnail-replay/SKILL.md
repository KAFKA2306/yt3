---
name: thumbnail-replay
description: Reproduce a high-CTR YouTube thumbnail update from published video metadata, generate variants with imagegen, validate them, and replace the live thumbnail via YouTube Data API.
type: skill
---

# Thumbnail Replay

## Objective

Reproduce thumbnail updates with minimal steps and high fidelity:
metadata in -> thumbnail out -> QA -> YouTube replace -> verify.

## When to Use

- User wants to recreate or improve a published video's thumbnail from YouTube metadata.
- User wants a repeatable thumbnail workflow with imagegen and YouTube API replacement.
- User says `再現`, `reproduce`, `replace thumbnail`, or `CTR-focused thumbnail`.

## Core Flow

1. Read the live YouTube metadata first.
2. Build a prompt from the title, description, and tags.
3. Generate 1-3 variants with `image_gen`.
4. Save the chosen image into `runs/YYYY-MM-DD/<project_id>/thumbnail.png`.
5. Normalize to `1280x720` if needed.
6. Run thumbnail QA.
7. Upload with `youtube.thumbnails.set`.
8. Re-check with `youtube.videos.list`.

## Guardrails

- Keep the prompt short.
- Prefer one strong visual hook over many details.
- Keep mobile readability first.
- Do not change the video title or description unless explicitly asked.
- Verify the live channel before any API write.

## Reference

See [replay.md](references/replay.md) for the compact command pattern and replay checklist.
