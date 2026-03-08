---
name: design-system
description: Visual identity and layout standards for YT3 thumbnails and UI assets (2026 Financial Protocol). Use when generating thumbnails, UI components, CSS styles, or reviewing visual output for brand consistency. Triggers on "thumbnail", "design", "layout", "color", "typography", "UI component", or any visual asset generation.
---

# Design System (2026 Financial Protocol)

## Typography

**Latin text**: Atkinson Hyperlegible — optimized for information density and screen legibility.

**Japanese text**: Noto Sans JP — see `japanese-typography` skill for the full font stack and weight hierarchy.

**Size hierarchy**:
- Title: 90px
- Subtitle: 48px–64px

Verify mobile legibility before final render — thumbnails are viewed at small sizes first.

## Color

| Role | Value |
|------|-------|
| Base | `#103766` (Deep Navy) |
| Accent | `#288CFA` (Vibrant Blue) |

Minimum contrast ratio for all text/background pairs: 7.0:1. Use a contrast checker before approving.

## Layout

- Primary content padding: 80px safe zone on all sides
- Character placement (Tsumugi/Zundamon): Rule of Thirds — characters frame data, never obstruct it
- No parameter hardcoded in source — all tokens come from `config/default.yaml`
