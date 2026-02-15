---
description: lint, test, and commit changes
---
# Ship (Lint → Test → Commit)

// turbo
1. Type-check and lint:
```bash
task lint
```
// turbo
2. Run tests:
```bash
npm test
```
3. If lint or tests fail, fix the issues and re-run.
4. Stage and commit:
```bash
git add -A && git status
```
```bash
git commit -m "[type]: [description]"
```

Commit types: `feat`, `fix`, `refactor`, `destruct`, `chore`, `docs`.
