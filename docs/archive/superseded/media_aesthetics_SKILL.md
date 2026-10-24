---
name: Media Aesthetics & Layout
description: Background knowledge for visual design, typography, and media safety zones.
---

# Media Aesthetics & Layout Skill

Standardize visual quality and layout efficiency for media generation (`yt3` project).

## Core Directives

### 1. Typography Standards
- **Subtitles**: use `Zen Maru Gothic Bold`. Base size: `52px`.
- **Contrast**: use outlines or drop shadows to ensure readability against dynamic backgrounds.

### 2. Layout Safety Zones (1920x1080)
- **Character Overlays**: Right-side (Tsumugi) vs Left-side (Zundamon).
- **Subtitle Safe Area**: `401px` to `1422px` (X-axis).
- **Thumbnail (1280x720)**: Right-side guardband (600px) for character placement.

### 3. Color Strategy
- **Background**: `#193D5A` (Dark Blue) as the base palette.
- **Tokens**: align with the "Human-Centric & Borderless" Design System (Digital Blue / Serendie Teal).

## Aesthetics Protocol
- **Smoothness**: Use `cubic-bezier` for transitions.
- **Premium Feel**: Apply `backdrop-filter` where transparency is used.
- **WOW Factor**: Prioritize high-fidelity assets; avoid defaults.

## Workflow
1. **Layout Calc**: Use `SmartLayoutEngine` logic to prevent text/character overlap.
2. **Visual Audit**: Verify margins and safety zones before final export.
3. **Style Sync**: Ensure color tokens match `DESIGN_SYSTEM.md`.
