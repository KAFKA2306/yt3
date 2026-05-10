---
name: visual-design
description: Skill for integrated management of thumbnail and UI visual specifications. Handles Japanese typography, color schemes, layout, readability verification, and Yawa Archive ASMR thumbnail standards.
type: skill
---

# Visual Design

## Objective

Maintain visibility and brand consistency for thumbnails and UI.

For Yawa Archive ASMR, prioritize lived-in reality, imperfect framing, and anti-AI aesthetics.

## Essential Paths

- Root: `/home/kafka/2511youtuber/v3/yt3`
- Image Output: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`
- Font Reference: `Noto Sans JP`
- Standard Workflow: `/home/kafka/2511youtuber/v3/yt3/docs/standard/asmr-workflow.md`

## Formatter/Validation

- CSS/TS Formatting: `bun run format`
- Build Validation: `bun run build`

## Workflow

1. Apply `Noto Sans JP` when Japanese characters are present.
2. Define primary colors based on `#103766` and `#288CFA`.
3. Separate title and auxiliary information hierarchies.
4. Verify readability on mobile scaled-down displays.
5. Save outputs to the run directory.

## Yawa Archive Rules

- Use the visual identity from `docs/adr/0009-kafka-visual-identity-standard.md`.
- Avoid glossy AI-anime appearance, symmetrical composition, and jewel-like eyes.
- Favor matte finish, visible fabric weave, slight asymmetry, and practical clutter.
- Keep thumbnails compatible with the current Yawa Archive facility branding.

## Persistence Rules

- Always place the final image output at `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/thumbnail.png`.
- Do not stop working until the final path is determined. Do not leave files in temporary locations.
- After replacing an image, execute `task asmr:video DIR=/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>` in the next step to regenerate `final_video.mp4`.
- Align with `ADR-0021` by prioritizing lived-in reality, natural imperfections, and low saturation over excessive AI-like effects.
