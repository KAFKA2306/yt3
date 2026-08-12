---
name: repo-structure-governance
description: Inspects repo layout, identifies mixed responsibilities, detects architecture drift or lifecycle contamination, and validates directory/governance rules.
type: skill
---

# Repo Structure Governance

## Objective

Audit the repository structure and governance rules to detect directory contamination, boundary violations, or architecture drift.

## Workflow

1. **Inspect Repo Layout**: Scan the directory tree and identify the active project layout.
2. **Identify Mixed Responsibilities**: Check if source files, configurations, or temporary runs are placed in incorrect boundaries (e.g., shared directories, prohibited terms).
3. **Detect Lifecycle Contamination**: Find temporary run artifacts, builds, or log files stored outside domain-prefixed paths.
4. **Propose Canonical Structure**: Define the correct organizational structure based on repository governance policies.
5. **Emit Migration Recommendations**: Provide clear action items to clean up and restructure the files.
