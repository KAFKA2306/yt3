# Hierarchical Memory Layering Strategy

Context Compression — メモリ読み込みを層構造化して token 効率化

## Design Principles

1. **Token Efficiency**: Only load memories relevant to current task
2. **Cognitive Load**: Reduce working memory by separating concerns
3. **Fast Access**: Core knowledge always available, reference on-demand
4. **Scalability**: Support growing memory without context bloat

## Layer Definitions

### Layer 1: Core Knowledge (~3-5k tokens)

**Purpose**: Foundational directives that apply to *every* task

**Always Loaded**: Session start, never skipped

**Content Examples**:
- Development philosophy (minimal design, fail-fast)
- Model behavior directives (context hygiene, cleanup rules)
- Universal coding standards (naming, type safety, error handling)

**When to Add to Layer 1**:
- Rule affects 90%+ of all coding tasks
- Principle must be remembered across session boundaries
- Violation would cause systemic issues

**When to Remove from Layer 1**:
- Context becomes outdated (e.g., tool APIs change)
- Rule only applies to specific domain
- Can be inferred from other layer memories

---

### Layer 2: Development Context (~5-8k tokens)

**Purpose**: Reference during active feature work, architecture, and implementation

**Load Trigger**:
- Coding/refactoring task begins
- Architecture decision needed
- Building/testing workflow
- `task build`, `task test`, `task dev` commands

**Content Examples**:
- Project architecture and module organization
- Common build/test/debug commands
- Codex documentation standards
- Feature development patterns
- Current tech stack details

**When to Add to Layer 2**:
- Knowledge needed during implementation (not afterwards)
- Applies to specific domains or feature areas
- Changes monthly or seasonally (workflow updates)
- Supports active development decisions

**When to Drop from Layer 2**:
- Task context shifts (e.g., from coding to reviewing)
- Information can move to Layer 3 for archival

---

### Layer 3: Reference Library (~unlimited)

**Purpose**: Contextual knowledge loaded on-demand via file reads

**Load Trigger**: Explicit file reference or tool call (never auto-loaded)

**Content Examples**:
- Historical task status and completion logs
- System architecture deep-dives
- Team coordination notes
- Domain-specific patterns (finance, qualification)
- Analysis and decision records

**When to Add to Layer 3**:
- Historical or archival content
- Domain-specific reference (not universally applicable)
- Large analysis that's rarely accessed
- External reference that changes frequently

**When to Retire from Layer 3**:
- Content becomes stale (>3 months old without updates)
- Can be archived to separate history/ directory
- Superceded by newer analysis

---

## Loading and Eviction Strategy

### Initialization (Session Start)

1. Load MEMORY.md index (this file stays tiny, ~150 lines)
2. Auto-load all Layer 1 memories
3. **Do not** auto-load Layer 2 or 3

### During Session (Dynamic Loading)

**Trigger: Coding Task Begins**
```
IF task involves feature implementation OR bug fix OR refactoring:
  LOAD: Layer 2 memories (development context)
  SET: Active context = [Layer 1 + Layer 2]
```

**Trigger: Reference Needed**
```
IF user asks about architecture OR completion status OR domain patterns:
  READ: Specific file from Layer 3 via tool
  KEEP in context only while relevant
```

**Trigger: Context Pressure (>70% capacity)**
```
IF token usage approaching limit:
  EVICT: Layer 2 memories (least critical for initial phase)
  KEEP: Layer 1 (always required)
  RETAIN: Active file reads from Layer 3 (user requested)
```

### End of Session

1. **No Persistence**: Layer 2 auto-unloads after task completion
2. **Preserve Layer 1**: Always survives to next session
3. **Archive Layer 3**: User can save session state if needed

---

## Best Practices

### For Writing Memories

1. **Layer 1 (Core)**
   - Max 5k tokens total
   - Universal truths only
   - Update via TaskUpdate, not frequent edits

2. **Layer 2 (Development)**
   - Organized by feature area (project_overview, commands, architecture)
   - Include trigger conditions in frontmatter
   - Keep individual files <2k tokens

3. **Layer 3 (Reference)**
   - Organize into topic subdirectories (task/, architecture/, yt3/)
   - No size limit, but keep individual files <5k for readability
   - Archive old entries to maintain index clarity

### For Loading Memories

1. **Start Simple**: Let Layer 1 guide initial work
2. **Add Context as Needed**: Explicitly request Layer 2 when architecture matters
3. **Audit Usage**: After complex task, note which Layer 2 memories were most valuable
4. **Feedback Loop**: If Layer 2 not accessed in 5+ sessions, reconsider placement

### For Updating Memories

1. **Check Staleness**: Before using memory, verify it reflects current code
2. **Update Incrementally**: Don't rewrite entire file; use edit_memory tool
3. **Track Changes**: Note date in file when major updates occur
4. **Test Assumptions**: If memory contradicts observed code, trust code first

---

## Monitoring and Optimization

### Token Usage Tracking

After major implementation tasks, note:
- Which Layer 1 memories were referenced?
- Which Layer 2 memories were most valuable?
- Which Layer 3 files were manually requested?
- Was context eviction needed? (If yes, Layer 2 is too large)

### Quarterly Review

1. Remove outdated Layer 1 directives
2. Move stale Layer 2 content to Layer 3 or archive
3. Clean up Layer 3: archive entries >6 months old
4. Update this strategy doc based on lessons learned

---

## Examples

### Example 1: Simple Bug Fix

**Task**: Fix null pointer in user authentication

1. **Session Start**: Load Layer 1
2. **Begin Work**: Recognize coding task → Load Layer 2
3. **Reference Auth Logic**: Read `layer3_reference/yt3/patterns.md` manually
4. **Complete**: Layer 2 auto-evicts; Layer 1 persists

**Token Cost**: Layer 1 (3k) + Layer 2 (6k) + ad-hoc reads (~500) = ~9.5k active

### Example 2: Architecture Review

**Task**: Design new data pipeline

1. **Session Start**: Load Layer 1
2. **Architecture Task**: Load Layer 2 (Codex structure, project overview)
3. **Deep Design**: Manually read `layer3_reference/architecture/claude_consolidation.md`
4. **Complete**: Context shift to implementation → Layer 2 persists if coding follows

**Token Cost**: Layer 1 (3k) + Layer 2 (6k) + ad-hoc reads (~2k) = ~11k active

### Example 3: Context Pressure (>80%)

**Scenario**: In-progress coding work, approaching context limit

1. **Detect Pressure**: Used ~160k of 200k tokens
2. **Preserve Critical**: Keep Layer 1 (3-5k)
3. **Evict Optional**: Remove Layer 2 (5-8k)
4. **User Action**: Explicitly ask for specific Layer 2 file if needed

**Recovery**: Start new session or ask to reload Layer 2 context

---

## Related Documents

- **MEMORY.md** — Index of all memories (entry point)
- **layer1_core/** — Foundational directives (always loaded)
- **layer2_development/** — Development context (load on demand)
- **layer3_reference/** — Reference library (manual access only)
