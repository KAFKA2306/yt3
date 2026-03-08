---
name: viral-narrative
description: Transforms complex data into addictive entertainment via character-driven dialogue, ensuring maximum retention and structural understanding through specialized archetypes.
---

# Viral Narrative (ScriptSmith)

## Position in Workflow
- **Phase**: Design / Code (Script generation and narrative structure)

## 📋 Rationale for Strategic Shift
1. **Dynamic Character Synergy**: By defining characters through high-fidelity English archetypes, we ensure consistent personality and tone across diverse topics, maximizing viewer engagement.
2. **Cognitive Retention**: Information "stickiness" is achieved by framing data as a "Joint Investigation," moving away from lecture-style delivery to collaborative discovery.
3. **Emotional Calibration**: Establishing clear emotional bounds (Supportive/Inquisitive) prevents "Debunking" or "Hostile" tones, maintaining a safe and inviting viewer environment.

---

## 🎭 Character Archetypes & Performance Rules

### 1. Kasukabe Tsumugi (High-Performance Saitama Gyaru)
*   **Persona**: Precise, objective, yet exceptionally warm. She is a "Hyper Saitama Gyaru" serving as a Senior Analyst.
*   **Tone**: Supportive, "Otaku-friendly," and all-accepting.
*   **Linguistic Constraint**: USE "Aashi" (あーし) as the first-person pronoun. 
*   **Role**: ACTS as the expert guide who explains complex facts with a gentle, peer-to-peer charm.

### 2. Zundamon (Positively Inquisitive Fairy)
*   **Persona**: Enthusiastic, curious, and represents the "Positive Learner."
*   **Tone**: Slightly boastful but ultimately helpful. Acts as the viewer's avatar.
*   **Linguistic Constraint**: MANDATORY USE of "Nanoda" variations (`～なのだ`, `～のだ！`, `～なのだ？`). DO NOT USE `～なのだよ` or `～なのだぞ`.
*   **Role**: ASKS the "Hidden Why" and TRANSLATES data into daily life impacts.

---

## ⚡ Narrative Execution Rules (Core Triggers)

1. **Joint Investigation Pattern**:
   *   *Action*: STRUCTURE scripts as a 50/50 dialogue split. Tsumugi PROVIDES the observation, Zundamon PROVIDES the curiosity.
   *   *Goal*: LEAD the viewer to a shared realization, not a lectured conclusion.
2. **The "Pulse-to-Life" Bridge**:
   *   *Action*: Every major data point MUST be followed by a "Direct Impact" brainstorm (e.g., how it affects energy bills, grocery costs, or commute times).
   *   *Trigger*: "How does this change our tomorrow?"
3. **Anti-Alarmist Integrity**:
   *   *Action*: EXPLICITLY BAN "Doom," "Collapse," or "The End" narratives. 
   *   *Trigger*: FOCUS on "Dynamic Adaptation" and "Adaptive Growth."
4. **Natural Character Flow**:
   *   *Action*: ELIMINATE formal greetings or mechanical intros. START directly with a relatable scenario or a "Maximum Impact Fact" from the Daily Pulse.

---

## 📝 Scripting Iron Rules
*   **No Metadata as Dialogue**: DO NOT include system noises, countdowns, or BGM cues in the lines.
*   **Honest Uncertainty**: If a fact is complex, characters MUST acknowledge it honestly to maintain trust.
*   **Formatting**: USE valid JSON with `speaker` and `text` fields ONLY.

## ⚠️ Local LLM (Qwen3.5-9B) Constraints
- **4096 Token Limit**: KEEP scripts short (max 20-30 lines per turn). DO NOT output redundant character descriptions.
- **Redundancy Prohibition**: OUTPUT ONLY the JSON script. DO NOT provide meta-commentary or scene descriptions.

## 🚫 Negative Constraints (MANDATORY)
- **DO NOT** use formal greetings or introductory filler.
- **DO NOT** use "Doom" or "Collapse" narratives.
- **DO NOT** include metadata or stage directions in the dialogue.
- **DO NOT** deviate from character-specific linguistic constraints (Aashi/Nanoda).
- **DO NOT** exceed the 4096-token context limit during script generation.
