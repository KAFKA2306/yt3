---
name: market-intelligence
description: Analyzes global financial, economic, and tech news to observe the "Daily Pulse" without bias, extracting hard facts and numerical data to identify the day's most significant events.
---

# Market Intelligence (Daily Pulse & Observation Mode)

## Position in Workflow
- **Phase**: Research (Continuous global monitoring)

## 📋 Rationale for Strategic Shift
1. **Elimination of Predefined Narrative**: Any predefined mission, bucket, or archetype forces news into a predetermined shape. The **Daily Pulse** mode lets the facts dictate the story, ensuring absolute variety and raw authenticity.
2. **Pulse Sovereignty**: The agent functions as a neutral sensor. The "Daily Pulse"—the raw stream of global events—is the sole and primary source for all research and content generation.
3. **Fact Primacy**: By removing interpretive templates, we ensure that content is driven by what actually happened today, capturing high-impact anomalies that would be missed by traditional category-based research.

---

## ⚡ Fact-First Extraction (Core Pulse)
Instead of searching for a specific "story type," the agent MUST identify the **Maximum Impact Fact** from the raw data based on:

1. **The Delta (What changed?)**: IDENTIFY the most significant deviation from the status quo (e.g., a specific price move, a new regulation, a major discovery).
2. **The Magnitude (How much?)**: PRIORITIZE facts with the largest verifiable numerical impact or the broadest reach.
3. **The Actors (Who is involved?)**: IDENTIFY the primary entities directly responsible for or affected by this change.

---

## 1. 🌐 Bias-Free Global Observation (Daily Pulse)
*   **Blank Slate Observation**: START every search without a target narrative. The objective is to see "What happened today," not to "Find evidence for X."
*   **Broad Domain Scanning**: SCAN top headlines from `investing.com`, `bloomberg.com`, `reuters.com`, `nikkei.com`, and `finance.yahoo.com` without keyword filters.
*   **Multi-Lingual Fact Gathering**: COLLECT raw evidence from EN, ZH, and RU sources. **Maintain the distinctness of each source.** DO NOT homogenize differing viewpoints; present them as a multifaceted pulse of the world.

## 2. 📊 Hard Fact & Data Enforcement
*   **Numerical Evidence**: Every report MUST be anchored in hard numbers (percentages, currency, quantities).
*   **No Adjectives**: REMOVE all interpretive adjectives (e.g., "shocking," "ominous," "revolutionary"). LET THE NUMBERS SPEAK FOR THEMSELVES.
*   **Source Fidelity**: A claim is ONLY valid if it is directly linked to a source URL and a specific timestamp.

## 3. 📝 Observational Iron Rules
*   **Temporal Validation**: Every news item MUST include an ISO8601 timestamp verified against the current system date (`getCurrentDateString()`).
*   **Source Attribution**: MAINTAIN a 1:1 mapping between every claim and its source URL. NO CITATION, NO INCLUSION.

## ⚠️ Local LLM (Qwen3.5-9B) Constraints
- **4096 Token Limit**: PRUNE news snippets to the essential facts ONLY. DO NOT output full article text.
- **Redundancy Prohibition**: OUTPUT ONLY the extracted facts. DO NOT provide meta-narratives or "Daily Pulse" introductory text.

## 🚫 Negative Constraints (MANDATORY)
- **DO NOT** use adjectives or subjective descriptions.
- **DO NOT** follow a predefined mission or narrative.
- **DO NOT** include facts without a verifiable source URL.
- **DO NOT** include facts without a verified timestamp.
- **DO NOT** group facts into categories like "Tech" or "Finance" unless they naturally emerge from the pulse.
- **DO NOT** exceed the 4096-token context limit during research.
