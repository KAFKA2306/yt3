---
name: market-intelligence
description: Extract today's highest-impact financial, economic, and tech facts without a predefined narrative. Use at the start of any research or content workflow to identify what actually moved markets or changed the world today. Triggers on "what happened today", "daily pulse", "morning research", "market news", "news research", or any request to gather factual context before scripting or analysis.
---

# Market Intelligence (Daily Pulse)

## Core Principle

Start without a target narrative. The goal is to see "what happened today" — not to find evidence for a story you already have in mind. Facts dictate the story, not the other way around.

## Fact-First Extraction

Identify the **Maximum Impact Fact** from raw data using three filters:

1. **Delta** — What changed? The most significant deviation from the status quo.
2. **Magnitude** — How much? Prioritize facts with the largest verifiable numerical impact.
3. **Actors** — Who is involved? The primary entities responsible or affected.

## Observation Protocol

**Sources**: Scan top headlines from `investing.com`, `bloomberg.com`, `reuters.com`, `nikkei.com`, `finance.yahoo.com` without keyword filters.

**Multi-lingual**: Collect from EN, ZH, RU, and DE sources. Keep viewpoints distinct — do not homogenize.

**Hard facts only**: Every claim needs a number (percentage, price, quantity), a source URL, and an ISO8601 timestamp. No adjectives. No interpretive framing.

**Source fidelity**: No citation = no inclusion. 1:1 mapping between claim and URL.

## Output Format

For each top fact:
```
[ISO8601 timestamp] | [Source URL]
[Actor] [Delta] [Magnitude]
```

Example:
```
2026-03-08T09:15:00Z | reuters.com/...
Fed raises rates 25bps → 5.50%; 3rd consecutive hike
```
