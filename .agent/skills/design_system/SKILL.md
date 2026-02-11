---
name: Design System Strategy
description: Rules for applying the Human-Centric & Borderless Design System (Digital Agency x Serendie).
---

# Design System Guidelines (鉄の掟)

**Reference**: `file:///home/kafka/projects/DESIGN_SYSTEM.md`

## 1. Core Philosophy (Human-Centric & Borderless)
*   **Accessibility First**: WCAG 2.1 AA compliance is mandatory.
*   **Adaptability**: Components must work in both Light and Dark modes.
*   **Zero-Fat**: No decorative CSS, no unused classes.

## 2. Design Tokens (The Immutable Truth)
Do NOT hardcode colors. Map existing vars to these tokens.

*   **Primary**: `#005CB9` (Digital Blue) -> `var(--color-primary)`
*   **Accent**: `#00A3AF` (Serendie Teal) -> `var(--color-accent)`
*   **Text**: `#FFFFFF` -> `var(--color-text)`
*   **Typography**: `"Noto Sans JP", sans-serif`

## 3. Platform Standards
### Web (TS/JS)
*   **Semantic HTML**: No `div` soup.
*   **Focus**: Visible focus state (Teal).

### Data & Plots (Python)
*   **Series**: Use `Serendie Teal`.
*   **Background**: Match `--color-background` (`#0A0A12`) or transparent.

### Media (Sharp/FFmpeg)
*   **Safe Zone**: Critical info within 90% center.
*   **Contrast**: Outlined text for thumbnails.

## 4. Coding Tone
*   **Zero-Fat**: No comments, minimal branching.
*   **Protocols**: Follow `.claude/rules/` (Silent Operator).
