---
name: notebooklm-integration
description: NotebookLM CLI requirements for yt3 agent integration
version: 1.0.0
trigger: "when implementing NotebookLMAgent"
---

# NotebookLM CLI Integration Requirements

Verify these notebooklm-py CLI commands **before** implementing NotebookLMAgent.

## CLI Commands to Confirm

| Command | Verify | Critical Info Needed |
|---------|--------|----------------------|
| `notebooklm create "name"` | Creates notebook | Output format (ID extraction method) |
| `notebooklm use <id>` | Sets context | Required before `source add`? |
| `notebooklm source add "url"` | Adds source | Supports file paths? URLs only? Can pass multiple? |
| `notebooklm generate video --style whiteboard --wait` | Generates video | Where is output saved? Filename? How to retrieve path? |
| `notebooklm download video <path>` | Downloads video | Auto-detects latest video? Format param exists? |
| `notebooklm login` | Authenticates | CI-friendly? Where are credentials stored? |
| `notebooklm auth check --test` | Validates auth | Works without interactive prompt? |

**Source**: https://github.com/teng-lin/notebooklm-py (README + CLI Reference)

## Architecture Decision

NotebookLMAgent will extend BaseAgent (see: `src/core.ts`) and integrate into workflow DAG after VisualDirector:

```
VisualDirector (TTS, composition) → NotebookLMAgent → PublishAgent
```

- Input: Script + research data + source URLs
- Output: Video path for PublishAgent to upload
- Location: `src/domain/agents/notebooklm.ts`
- Config: `agents.notebooklm.*` in `config/default.yaml`

## Critical Integration Points

### 1. Notebook ID Extraction
- `notebooklm create` output format determines parsing logic
- Example: UUID pattern `[a-f0-9\-]{36}` vs JSON response
- **Must confirm** exact output before parsing

### 2. Video Output Path
- Does `notebooklm generate video --wait` return a path?
- Or must we locate file in filesystem after generation?
- Where is the default save location?
- **Must confirm** to reliably download to `runs/<run-id>/notebooklm/`

### 3. Authentication in CI
- Does `notebooklm login` work in non-interactive environments?
- Can credentials be pre-set via env vars or config file?
- How to validate auth without browser?
- **Must confirm** before running in automation

### 4. Source Management
- Can `notebooklm use <id>` be called once and reused?
- Or must it be called before each `source add`?
- Can sources be added in bulk or only one-at-a-time?
- **Must confirm** to optimize workflow

## Testing Strategy

Once CLI confirmed:
- Unit test: `createNotebook()` with mocked execSync
- Integration test: Real notebooklm-py CLI (requires auth + quota)
- E2E test: Full workflow with notebook creation → video generation → download

See yt3 testing patterns in `tests/core.test.ts`.

## Fail-Fast Implementation

NotebookLMAgent follows yt3 philosophy:
- ❌ NO retry logic or fallbacks
- ✅ Throw immediately on CLI failure
- ✅ Operator fixes root cause and reruns

Example:
```
Error: notebooklm create failed
→ Fix: notebooklm auth check --test
→ Rerun: task run
```

## Files to Create/Modify

- Create: `src/domain/agents/notebooklm.ts` (extend BaseAgent)
- Update: `src/config_types.ts` (add NotebookLMConfig schema)
- Update: `src/graph.ts` (add notebooklm node + edges)
- Update: `config/default.yaml` (add agents.notebooklm config)
- Update: `src/types.ts` (extend WorkflowState with notebooklmVideo)
- Create: `tests/agents/notebooklm.test.ts`

## Reference

- **yt3 BaseAgent pattern**: `src/core.ts`
- **yt3 agent examples**: `src/domain/agents/`
- **LangGraph integration**: `src/graph.ts`
- **Config types**: `src/config_types.ts`
