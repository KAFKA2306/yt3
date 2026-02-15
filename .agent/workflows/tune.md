---
description: tune prompts, personas, and content quality parameters
---
# Prompt & Quality Tuning

1. **Identify target**: Which prompt YAML to edit (`prompts/research.yaml`, `prompts/content.yaml`, `prompts/critic.yaml`).
2. **Edit prompts**: Modify the YAML. Key levers:
   - Research: specificity, "counter-intuitive facts", language sources
   - Content: hook engineering, persona hardening, segment structure, character count
   - Critic: rubric aggressiveness, tone check, engagement scoring
3. **Config tuning** (if needed): Edit `config/default.yaml` for duration, limits, model params.
4. **Verify with dry run**:
// turbo
```bash
task dryrun
```
5. **Evaluate with The Critic**:
// turbo
```bash
task evaluate
```
