---
name: design-system
description: Defines the visual identity and aesthetic standards for the YT3 project, ensuring high-density, professional video and thumbnail output through the 2026 Financial Protocol. Use this skill when generating UI assets, applying typographic hierarchies, or ensuring brand consistency across automated media outputs.
---

# Design System (2026 Financial Protocol)

## Position in Workflow
Use this skill during:
1. **Design**: Establishing layout constants and typographic scales.
2. **Code**: Implementing UI components and CSS styles.
3. **Review**: Auditing visual outputs against the 2026 Financial Protocol.

## Core Principle
**Aesthetic Authority over Convenience.**
Visual consistency builds institutional trust. Never deviate from the protocol.

## Workflow

### 1. Typographic Calibration
- **MANDATORY**: Use "Atkinson Hyperlegible" for all Latin informational text.
- **MANDATORY**: For all Japanese text, apply `.agent/skills/japanese_typography/SKILL.md` — Noto Sans JP is the sole authorized Japanese font.
- **MANDATORY**: Adhere to the defined hierarchy: Title (90px), Subtitle (48px-64px).
- **Audit**: Verify mobile legibility before final render.

### 2. Color Implementation
- **Base Color**: #103766 (Deep Navy).
- **Accent Color**: #288CFA (Vibrant Blue).
- **MANDATORY**: Maintain a 7.0:1 contrast ratio for all text/background pairings.

### 3. Layout Constraints
- **Safe Zones**: Enforce 80px padding for all primary content.
- **Balance**: Position characters (Tsumugi/Zundamon) using the Rule of Thirds. Do NOT obstruct data points.

## Negative Constraints (What NOT to do)
- **PROHIBITED**: Do not use "Please" or "Should" in design instructions. Use absolute pixel values.
- **PROHIBITED**: Do not hardcode visual parameters in source files. Use `config/default.yaml` tokens.
- **PROHIBITED**: Do not sacrifice readability for aesthetics.
- **LOCAL LLM LIMIT**: Limit design spec descriptions to under 50 words to respect the 4096-token context window.
