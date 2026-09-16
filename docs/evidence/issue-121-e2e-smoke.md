# Issue #121 E2E smoke contract

This issue is closed only when CI renders and verifies real media, not merely when renderer commands exit zero.

The canonical smoke must prove:

- self-hosted pinned Noto Sans JP is loaded explicitly by the Remotion browser
- all ten fixed templates are exercised by a real multi-scene render
- Japanese main, English main, and Japanese 9:16 Short contain video and audio streams
- Short contains HOOK / HIGHLIGHT / CTA roles with source dialogue provenance
- at least three distinct ffprobe-measured audio durations drive the timeline
- audio/video stream duration drift is no more than 100 ms
- subtitle, safe-area, overlap, and broken-source negative QA fixtures fail as expected
- representative PNG frames are retained as evidence
- uploaded evidence excludes node_modules and is packaged below 25 MiB

The runtime evidence is produced by `src/scripts/smoke_episode_pipeline.ts` and uploaded by `.github/workflows/ci.yml`.
