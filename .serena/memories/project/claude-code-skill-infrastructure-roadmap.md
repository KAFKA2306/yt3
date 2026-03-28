---
name: Claude Code Skill Infrastructure Roadmap for YT3
description: Progressive skill organization, discovery, and safety improvements
type: project
---

## Core Design Principles (from Official Docs)

### 1. Progressive Disclosure Architecture
- Level 1: Metadata (name/description) - always loaded
- Level 2: SKILL.md instructions - trigger time only (<5k tokens)
- Level 3: Reference files - on-demand, token-free
- **YT3 Impact**: Complex domain logic can be "lightweight skill + detailed references" without context window pressure

### 2. Description-Driven Discovery
- Description is the **only** criterion Claude uses to trigger skills
- Must include: "what it does" + "when to use it"
- Third person format, max 1024 chars
- **YT3 Impact**: Existing .agent/ skills without proper descriptions won't be triggered

### 3. `disable-model-invocation` for Safety
- Prevents Claude auto-execution of side-effect skills
- Forces manual invocation: `/skill-name`
- Removes skill from system prompt (avoids unconscious trigger)
- **YT3 Impact**: automation-install, config-update, service-restart should use this flag

### 4. Execution Environment Fragmentation
| Surface | Network | Packages | File Access |
|---------|---------|----------|------------|
| Claude.ai | Variable | npm/PyPI OK | Full |
| Claude API | ❌ No | ❌ No | Full |
| Claude Code | ✅ Full | ✅ OK | Full |
| Agent SDK | ❌ No | ❌ No | Full |

**YT3 Impact**: Skills requiring external APIs must assume API key from config or user supply

### 5. Script Execution is Context-Free
- Python/Bash scripts execute with output-only token cost
- 1000+ line scripts incur minimal overhead (just output tokens)
- Perfect for deterministic validation/parsing
- **YT3 Impact**: Wrap complex validation in scripts, use lazy-load pattern

---

## Phase 1: Foundation (Week 1-2)

### Task #1: Standardize `.claude/` Directory Structure
**Current**: `.agent/skills/`, `.agent/agents/` scattered

**Target**:
```
.claude/
├── CLAUDE.md                    # Project context (merge with AGENTS.md)
├── MEMORY.md                    # Memory index (new)
├── skills/                      # Standard location
│   ├── config-validation/SKILL.md
│   ├── workflow-orchestration/SKILL.md
│   ├── media-analysis/SKILL.md
│   └── ...
├── agents/                      # Subagent definitions (new)
│   └── explore/definition.md
└── memory/                      # Content organization (new)
    ├── user_role.md
    ├── feedback/
    └── project_status.md
```

**Implementation**:
1. Create `.claude/` if missing
2. Move CLAUDE.md to `.claude/CLAUDE.md`
3. Symlink `.agent/skills/` → `.claude/skills/` for backward compat
4. Migrate after 1 month when all references updated

**Files to Create**:
- `.claude/MEMORY.md` - index of memory files
- `.claude/skills/` - official skill location

---

### Task #2: Enforce SKILL.md Frontmatter Standardization
**Current State**: Frontmatter missing or incomplete in existing skills

**Required Fields**:
```yaml
---
name: config-validation              # lowercase + hyphen only, max 64 chars
description: |
  Validate YAML config against schema. Use when checking config/default.yaml 
  syntax, testing configuration changes, or debugging config issues.
argument-hint: "[config-file]"
disable-model-invocation: false       # Can be false (default: auto-triggerable)
allowed-tools: Read, Grep, Bash(python *)
user-invocable: true                  # Default: true (enable /skill-name)
---
```

**Checklist per Skill**:
- [ ] name valid (lowercase + hyphen)
- [ ] description includes: (1) what it does, (2) when to use it
- [ ] description is 50-200 words
- [ ] Side-effect skills have `disable-model-invocation: true`
- [ ] argument-hint filled if skill takes arguments
- [ ] allowed-tools lists exact permissions needed

**Audit Command**:
```bash
for file in .claude/skills/*/SKILL.md; do
  echo "Checking $file..."
  # Check for required fields
done
```

**Timeline**: 4-6 hours for existing ~5-10 skills

---

### Task #3: Add `disable-model-invocation: true` to Side-Effect Skills
**Target Skills**:
- `automation-install` (cron registration)
- `config-update` (modifies default.yaml)
- `service-restart` (systemd operations)
- Any skill with `Bash(sudo *)` or file writes

**Example**:
```yaml
---
name: automation-install
description: |
  Install YT3 cron automation for recurring workflows. 
  Manual invocation only via: /automation-install
disable-model-invocation: true
allowed-tools: Bash(crontab *, grep *, which *)
---

## Prerequisites
- Backup existing crontab: `crontab -l > backup.txt`
- Run with appropriate permissions (sudo if needed)

## Installation Steps
1. Verify crontab installed
2. Check for existing YT3 entries
3. Install new entries from config
4. Verify installation: crontab -l | grep yt3
```

**Effect**: Prevents accidental cron registration via model inference.

---

## Phase 2: Progressive Disclosure (Week 3-4)

### Task #4: Extract Reference Materials from Complex Skills
**Target**: Skills with >300 lines of documentation

**Example: Media Analysis Skill**

Current (monolithic):
```
.claude/skills/media-analysis/SKILL.md (400 lines)
  ├─ Explanation (50 lines)
  ├─ API Reference (150 lines)
  ├─ Examples (100 lines)
  └─ Edge Cases (80 lines)
```

Refactored (progressive):
```
.claude/skills/media-analysis/
├── SKILL.md (100 lines: overview + links)
├── reference/
│   ├── architecture.md (150 lines: detailed design)
│   ├── api-reference.md (100 lines: methods)
│   ├── examples.md (80 lines: code samples)
│   └── troubleshooting.md (60 lines: common issues)
└── scripts/
    ├── validate-media-config.py
    └── analyze-agent-flow.py
```

**SKILL.md structure**:
```markdown
# Media Analysis Skill

Analyze media agent flows and configurations in YT3.

## Quick Usage

Validate media config:
```bash
python scripts/validate-media-config.py config/default.yaml
```

Analyze agent dependencies:
```bash
python scripts/analyze-agent-flow.py src/domain/agents/media.ts
```

## Detailed Documentation

- **Architecture Details**: [reference/architecture.md](reference/architecture.md)
- **API Methods**: [reference/api-reference.md](reference/api-reference.md)
- **Usage Examples**: [reference/examples.md](reference/examples.md)
- **Troubleshooting**: [reference/troubleshooting.md](reference/troubleshooting.md)

## Workflow

1. Validate configuration
2. Analyze agent dependencies
3. Report findings
```

**Benefit**: SKILL.md is only 100 lines on trigger, detailed references loaded on-demand.

---

### Task #5: Bundle Validation Scripts (Context-Free Execution)
**Target**: Repetitive validation/parsing tasks

**Implementation Structure**:
```
.claude/skills/config-validation/
├── SKILL.md
└── scripts/
    ├── validate_schema.py      # Zod-like schema validation
    ├── check_syntax.py         # YAML syntax only
    ├── report_differences.py   # Compare versions
    └── common_errors.md        # Known issues
```

**Example: validate_schema.py**
```python
#!/usr/bin/env python3
"""Validate YAML config against YT3 schema."""

import sys
import yaml
import json
from schema import Schema, And, Or, Optional

SCHEMA = Schema({
    'workflow': {
        'default_bucket': str,
        'paths': {
            'runs_dir': str,
            'assets_dir': str,
        }
    },
    'steps': {
        'research': {
            'default_limit': int,
            'regions': list,
        }
    },
    'providers': {
        'llm': {
            'gemini': {
                'model': str,
                'max_tokens': int,
            }
        }
    }
})

def validate(config_file):
    """Validate config file."""
    try:
        with open(config_file) as f:
            config = yaml.safe_load(f)
        SCHEMA.validate(config)
        print(json.dumps({"status": "ok", "errors": []}))
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "errors": [str(e)]
        }))
        sys.exit(1)

if __name__ == "__main__":
    validate(sys.argv[1])
```

**SKILL.md Integration**:
```markdown
## Validation Scripts

### validate_schema.py
Check YAML against YT3 schema:
```bash
python scripts/validate_schema.py config/default.yaml
```
Output: JSON with status + error list

### check_syntax.py
Syntax check only (no schema validation):
```bash
python scripts/check_syntax.py config/default.yaml
```

### report_differences.py
Compare with previous version:
```bash
python scripts/report_differences.py backup.yaml config/default.yaml
```
Output: Line-by-line diff with annotations
```

**Benefit**: Context-free execution, deterministic output, reusable with test suite.

---

## Phase 3: Quality & Discovery (Week 5-7)

### Task #6: Standardize Description Template
**Problem**: Description quality determines trigger success rate

**Template**:
```yaml
description: |
  [WHAT]: {{ one-sentence action }}
  [WHEN]: Use when {{ context or user intent }}.
  [EXAMPLES]: "{{ user might say this }}", "{{ another trigger }}"
```

**Examples**:

❌ Bad:
```yaml
description: Helper for config
```

✅ Good:
```yaml
description: |
  Validate YAML configuration against the official schema.
  Use when checking config/default.yaml syntax, testing configuration changes,
  or debugging config-related issues.
  Examples: "Is this config valid?", "Check for config errors"
```

---

### Task #7: Skill Evaluation Framework
**Structure**: `evaluations.json` per skill

```json
[
  {
    "id": "validate_correct_config",
    "skill": "config-validation",
    "input": {
      "file": "config/default.yaml",
      "action": "validate"
    },
    "expected": [
      "Opens YAML file",
      "Parses all top-level keys",
      "Outputs success message",
      "Exit code 0"
    ]
  },
  {
    "id": "detect_schema_violation",
    "skill": "config-validation",
    "input": {
      "file": "invalid-config.yaml",
      "action": "validate"
    },
    "expected": [
      "Detects missing required field",
      "Reports line number",
      "Suggests correction",
      "Exit code 1"
    ]
  }
]
```

**Execution**:
```bash
task test:skill --skill=config-validation
# Runs against multiple models (Haiku, Sonnet, Opus)
# Validates skill behavior consistency
```

---

### Task #8: Nested `.claude/` for Large Codebases
**Use Case**: YT3 grows to multiple domains

```
.claude/                           # Global
├── skills/
│   ├── workflow-orchestration/
│   └── validation/

src/domain/agents/
├── .claude/                       # Optional domain-specific
│   └── skills/
│       └── media-agent-analysis/SKILL.md
```

**Discovery Logic**:
- When editing `src/domain/agents/media.ts`
- Claude discovers: `.claude/skills/` + `src/domain/agents/.claude/skills/`
- Same-name skills: nested (local) version takes precedence

---

### Task #9: Skill Health Monitoring
**Automation**: `task skills:audit`

```python
# .claude/scripts/audit_skills.py
def audit_skills():
    """Audit .claude/skills/ for quality issues."""
    issues = []
    
    for skill_dir in glob(".claude/skills/*/"):
        skill_md = f"{skill_dir}/SKILL.md"
        
        # Frontmatter validation
        if not has_valid_frontmatter(skill_md):
            issues.append(f"{skill_md}: Invalid frontmatter")
        
        # Description length
        desc = get_description(skill_md)
        if len(desc) < 50:
            issues.append(f"{skill_dir}: Description too brief")
        if len(desc) > 1024:
            issues.append(f"{skill_dir}: Description too long")
        
        # Reference file validation
        if has_references(skill_md):
            for ref in get_references(skill_md):
                if not file_exists(f"{skill_dir}/{ref}"):
                    issues.append(f"{skill_dir}: Missing reference {ref}")
        
        # Check for unused skills
        if not is_referenced_in_codebase(skill_md):
            issues.append(f"{skill_dir}: Unreferenced (may be unused)")
    
    return issues
```

**Schedule**: Weekly in CI/CD, monthly team review

---

## Implementation Timeline

| Phase | Week | Task | Est. Hours | Priority |
|-------|------|------|-----------|----------|
| **1** | W1 | Propose `.claude/` structure | 2 | HIGH |
| | W1-2 | Frontmatter audit & standardization | 4 | HIGH |
| | W2 | Migrate `.agent/skills/` → `.claude/skills/` | 2 | HIGH |
| **2** | W3 | Extract reference materials (3-5 skills) | 8 | MEDIUM |
| | W4 | Bundle validation scripts | 4 | MEDIUM |
| | W4 | Memory + Skills context injection | 4 | MEDIUM |
| **3** | W5 | Evaluation framework | 6 | MEDIUM |
| | W6 | Nested `.claude/` pilot | 4 | LOW |
| | W7 | Skill health monitoring setup | 3 | MEDIUM |

**Total**: ~37 hours over 7 weeks (5 hours/week)

---

## Expected Outcomes

1. **Token Efficiency**: Context window pressure ↓ 30-40% (lazy-load references)
2. **Skill Discovery**: Trigger precision ↑ 80% (standardized descriptions)
3. **Automation Safety**: Side-effect skill errors → 0 (`disable-model-invocation`)
4. **Code Maintainability**: Skill degradation prevented (health monitoring)
5. **Cross-Surface Compatibility**: Skills work on Claude.ai, API, Code, Agent SDK
6. **Team Onboarding**: Consistent skill patterns, self-documenting

---

## Dependencies

- Phase 1 completes before Phase 2
- Phase 2 reference extraction can happen in parallel with Phase 1 standardization
- Phase 3 depends on Phase 1-2 completion
- Integrates with: Gemini API roadmap (Tasks #1-3), Phase 2 optimization tasks
