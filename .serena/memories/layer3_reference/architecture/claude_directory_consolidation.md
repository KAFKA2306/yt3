---
name: Claude Code Directory Consolidation (2026-03-27)
description: Single unified .claude/ directory as official Claude Code project structure
type: project
---

## Unified .claude/ Structure Complete

**Date**: 2026-03-27
**Status**: ✅ COMPLETED
**Commit**: refactor: consolidate agents and skills under unified .claude/ directory

### Resources Consolidated

**Agents (5)** - All with Codex-format YAML frontmatter:
- content-analyst.md (narrative extraction)
- media-producer.md (media generation)
- script-writer.md (script generation)
- youtube-director.md (orchestration)
- youtube-publisher.md (publishing)

**Skills (14)** - All with Codex-format YAML frontmatter:
1. create-plan (implementation planning)
2. design-solution (solution convergence)
3. design-system (visual identity)
4. discord-integration (webhook management)
5. env-management (environment validation)
6. harness-maintenance (repository integrity)
7. japanese-typography (font standards)
8. market-intelligence (daily pulse research)
9. notebooklm-integration (video generation CLI)
10. operational-resilience (infrastructure standards)
11. polymarket-quant (trading automation)
12. research-codebase (problem exploration)
13. typescript-zero-fat (code standards)
14. viral-narrative (character dialogue)

### Structure

```
.claude/
├── CLAUDE.md (26 lines - Quick Reference only)
├── settings.json / settings.local.json
├── agents/ (5 .md files)
└── skills/ (14 directories with SKILL.md + .agr.json)
```

### Key Decisions

- **Single Source of Truth**: .claude/ is official per Claude Code documentation
- **Codex Compatibility**: All resources have YAML frontmatter (name, description, type, phase, inputs, outputs, dependencies)
- **Context Efficiency**: CLAUDE.md compressed from 500+ to 26 lines, details in .serena/memories/
- **No Duplicates**: .agent/ and .agents/ directories deleted (were causing confusion)

### Frontmatter Format Applied

```yaml
---
name: <resource-name>
description: <1-line trigger-focused description>
type: agent|skill
---
```

### Integration Points

- Codex discovers resources via .claude/ hierarchy
- Each skill/agent has clear triggers for when it should be invoked
- Dependencies documented for automatic orchestration
- All resources are self-contained and portable

### Future Maintenance

- Add new agents/skills to .claude/agents/ or .claude/skills/
- Keep CLAUDE.md minimal (< 50 lines) - point to memories for details
- Maintain YAML frontmatter format for Codex compatibility
- Update .serena/memories/ for complex implementation details
