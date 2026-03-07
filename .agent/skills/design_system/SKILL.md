# Design System (VisualDirector)

**目的**: デジタル庁および Serendie の人間中心デザインシステムをメディア合成に適用し、プロフェッショナルかつ「脳に刺さる」視覚体験を最小のコードで実現する。
---
name: design-system
description: Standards and guidelines for creating premium, high-density visual content for the 2026 Financial Protocol. Ensures consistency in typography, color palettes, and layout across all video and thumbnail assets.
---

# Design System (2026 Financial Protocol)

**Objective**: Guarantee the production of premium, high-density visual assets that adhere to the 2026 Financial Protocol standards, maximizing viewer trust and authority through aesthetic excellence.

## 1. Typography & Readability
*   **Primary Typeface**: Use "Atkinson Hyperlegible" for all UI and informational text. It provides maximum clarity for complex financial data.
*   **Hierarchy**: Maintain a strict scale for titles (90px), subtitles (48px-64px), and body text to guide the viewer's eye through the most critical information first.
*   **Legibility Standard**: Ensure minimum x-height and contrast are met before final rendering. Text Must be readable on small mobile screens.

## 2. Color Palette (Auth & Trust)
*   **Base Color (#103766)**: Deep Navy representing stability and institutional trust. 
*   **Accent & Discovery Colors**: Use vibrant and clear accents (e.g., #288CFA, #00FFC2) to represent "Discovery" and "Intellectual Excitement." Avoid muddy or dark tones that induce fear.
*   **Contrast Layer**: Use sharp white (#FFFFFF) for primary text to ensure maximum legibility and a "Clean & Intelligent" aesthetic.

## 3. Visual Density & Layout
*   **Information Density**: Avoid empty space. Populate the screen with meaningful charts, ticker tapes, and real-time data feeds.
*   **Character Integration**: Position characters (Tsumugi, Zundamon) strategically to overlap with the UI, creating a sense of depth and interaction with the data.
*   **Thumbnail Optimization (5-Word Rule)**: Aggressively optimize thumbnails for 'Related Video' traffic by limiting prominent text to <5 words and utilizing high-contrast visual cues.

## 4. Performance & Execution
*   **Reliability**: All assets must be verified for contrast and sharpness (IQA thresholds) before final rendering.
*   **Efficiency**: Reuse predefined components from the `assets/` directory to minimize latency and ensure pixel-perfect consistency.
