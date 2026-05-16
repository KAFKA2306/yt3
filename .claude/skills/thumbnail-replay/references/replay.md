# Thumbnail Replay Reference

## Minimal Replay Pattern

1. Fetch live metadata.
2. Generate thumbnail variants.
3. Save to the run folder.
4. Resize to `1280x720`.
5. QA with `iqa_check.ts`.
6. Replace with `youtube.thumbnails.set`.
7. Verify with `youtube.videos.list`.

## Prompt Shape

Use:

- `title`
- `description`
- `tags`
- `thumbnail hook`
- `mobile-readable text`

Keep only the details needed to preserve the current video's meaning.

## Failure Rule

If the thumbnail fails QA, fix the image first. Do not upload a broken asset.
