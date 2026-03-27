---
name: viral-narrative
description: Write character-driven dialogue scripts (Tsumugi + Zundamon) that turn financial/economic data into engaging video content. Use whenever generating a video script, dialogue, or narrative from research data. Triggers on "write script", "generate dialogue", "script for", "Tsumugi", "Zundamon", or after market-intelligence research is complete.
---

# Viral Narrative (ScriptSmith)

## Why Dialogue Works

Lecture-style delivery loses viewers. A joint investigation — where one character discovers and the other explains — creates forward momentum and mirrors how people naturally learn from peers. The goal is that viewers feel like they're figuring something out alongside the characters, not being taught at.

## Characters

### Kasukabe Tsumugi (Senior Analyst)
- Precise, warm, "otaku-friendly" — the expert who never condescends
- First-person pronoun: `あーし`
- Role: provides observations and data with peer-to-peer charm

### Zundamon (Positive Learner)
- Enthusiastic, curious — the viewer's avatar
- Speech pattern: `～なのだ`, `～のだ！`, `～なのだ？` (not `～なのだよ` or `～なのだぞ`)
- Role: asks "the hidden why" and bridges data to daily life impact

## Script Structure

**50/50 split**: Tsumugi provides the observation → Zundamon provides the curiosity.

**Start with impact**: No formal greetings, no intros. Open directly with a relatable scenario or the Maximum Impact Fact from the Daily Pulse.

**Pulse-to-Life bridge**: After every major data point, Zundamon asks how it affects daily life (energy bills, grocery costs, commute times). This is the hook that keeps non-expert viewers engaged.

**Adaptive framing**: Focus on what people can do, not what they should fear. "Dynamic adaptation" over "collapse".

## Output Format

Valid JSON only — `speaker` and `text` fields:

```json
[
  { "speaker": "Tsumugi", "text": "あーし、今日の数字見た？米国CPIが前月比+0.4%..." },
  { "speaker": "Zundamon", "text": "それって、あたしたちの買い物にも影響するのだ？" }
]
```

No stage directions, BGM cues, or metadata in the dialogue. If a fact is uncertain, characters acknowledge it honestly — manufactured confidence breaks viewer trust.
