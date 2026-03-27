---
name: japanese-typography
description: Japanese font standards for YT3 — Noto Sans JP only. Use whenever rendering Japanese text in thumbnails, subtitles, UI components, or any visual asset. Triggers on Japanese text, "日本語", "font", "thumbnail", "subtitle", or any visual asset request containing Japanese characters.
type: skill
---

# Japanese Typography (Noto Sans JP)

## Why Noto Sans JP

Pan-CJK coverage with zero tofu rendering, optimized for screen reading, freely redistributable. System fonts (ヒラギノ, 游ゴシック, メイリオ) produce cross-platform inconsistency — avoid them entirely.

## Font Stack

```css
/* Display (thumbnails, titles) */
font-family: 'Geist', 'Noto Sans JP', sans-serif;

/* Readability (body, subtitles) */
font-family: 'Atkinson Hyperlegible', 'Noto Sans JP', sans-serif;
```

Load via Google Fonts CDN:
```
https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap
```

Noto Sans JP must be loaded before any Japanese text renders — no OS fallback.

## Weight Hierarchy
