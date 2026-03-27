---
name: notebooklm-integration
description: NotebookLM CLI requirements for yt3 agent integration. Use when implementing NotebookLM agent or validating CLI command compatibility. Triggers on "NotebookLM", "NotebookLMAgent", "notebook create", "notebook generate", or when setting up NotebookLM integration in the workflow.
type: skill
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
VisualDirector
    ↓
NotebookLMAgent
    ↓
PublishAgent
```

This ensures video generation and podcast creation happen in parallel with minimal orchestration overhead.
