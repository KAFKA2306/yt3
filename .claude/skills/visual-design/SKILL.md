---
name: visual-design
description: Skill for integrated management of thumbnail and UI visual specifications. Handles Japanese typography, color schemes, layout, and readability verification.
type: skill
---

# Visual Design

## Objective

Maintain visibility and brand consistency for thumbnails and UI.

## Essential Paths

- Root: `/home/kafka/2511youtuber/v3/yt3`
- Image Output: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`
- Font Reference: `Noto Sans JP`

## Formatter/Validation

- CSS/TS Formatting: `bun run format`
- Build Validation: `bun run build`

## Workflow

1. Apply `Noto Sans JP` when Japanese characters are present.
2. Define primary colors based on `#103766` and `#288CFA`.
3. Separate title and auxiliary information hierarchies.
4. Verify readability on mobile scaled-down displays.
5. Save outputs to the run directory.

## Persistence Rules

- Always place the final image output at `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/thumbnail.png`.
- Do not stop working until the final path is determined. Do not leave files in temporary locations.
- After replacing an image, execute `task asmr:video DIR=/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>` in the next step to regenerate `final_video.mp4`.
- Align with `ADR-0021` by prioritizing lived-in reality, natural imperfections, and low saturation over excessive AI-like effects.
