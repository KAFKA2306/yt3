---
name: copcon
description: Generate a full codebase context report using copcon and output it to copcon/context.md. Use when you need to provide a comprehensive snapshot of the codebase to an LLM, share context with another agent, or audit what files are included. Triggers on "context report", "copcon", "codebase snapshot", or "share codebase context".
argument-hint: [optional: path to target directory, defaults to current project root]
---

# Copcon Context Report

Generate a token-counted codebase context snapshot for LLM consumption.

## Workflow

### 1. Determine Target Directory

- **If argument provided**: use it as the target directory path.
- **If no argument**: use the project root (`.`).

### 2. Run copcon

```bash
task copcon
```

or with a custom path:

```bash
uv run copcon <directory> --output-file copcon/context.md
```

Output lands at `copcon/context.md`.

### 3. Report Results

After execution, report:
- Total token count
- Top 5 file types by token share
- Output file path: `copcon/context.md`

## Options

| Flag | Purpose |
|------|---------|
| `--depth N` | Limit directory traversal depth |
| `--output-file PATH` | Save report to file (default: `copcon/context.md`) |
| `--git-diff` / `-g` | Append `git diff HEAD` to the report |
| `--no-exclude-hidden` | Include hidden files/dirs |

## Typical Use Cases

- **Before sharing with another agent**: run `task copcon` and reference `copcon/context.md`
- **Auditing token budget**: check the distribution table to find heavy files to add to `.copconignore`
- **Git diff context**: `task copcon -- --git-diff` to include uncommitted changes

## .copconignore

Place a `.copconignore` file at the project root to exclude noise (binary assets, generated files, large data):

```
data/runs/
*.otf
*.wav
*.mp4
*.png
*.webp
*.psd
*.pickle
*.jsonl
bun.lock
```

## 🚫 Constraints

- DO NOT run copcon without `--output-file`; clipboard-only output is useless for agents.
- DO NOT include `copcon/context.md` in git commits.
