---
name: prompt-db-integrity-audit
description: Audits prompts.json database, validates block boundaries, checks for identity leakage or template pollution, and identifies cleanup candidates.
type: skill
---

# Prompt DB Integrity Audit

## Objective

Verify the consistency and hygiene of the prompt database (e.g., `prompts.json`) to prevent identity leakage, block pollution, or duplication.

## Workflow

1. **Load DB**: Read and parse the prompt database.
2. **Validate Schema/Rules**: Check if all prompt entries conform to the expected schema and formatting rules.
3. **Detect Mixed Concerns**: Check if prompts mix concerns (e.g., financial agent details leaking into humanity agents).
4. **Identify Duplicate Semantic Blocks**: Locate redundant or highly similar prompts and templates.
5. **Emit Cleanup Candidates**: List duplicate, stale, or malformed entries that should be pruned or refactored.
