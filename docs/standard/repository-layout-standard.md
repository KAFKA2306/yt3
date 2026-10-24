# Repository Layout Standard

Scope: root files, documentation, ADRs, branches, worktrees, and uncommitted state. Operational commands are owned by `Taskfile.yml`; agent rules are owned by `AGENTS.md`.

## 1. Root allowlist

Tracked repository content at the root contains only the names listed in `config/repo_layout.yaml` (`root.files` and `root.directories`). That file is the only allowlist, and `task audit:repo-layout` fails on any tracked root name it does not list. Ignored local runtime data may remain physically present but is not repository content.

Rules:

- Tool caches, editor state, and migration residue are gitignored at the source and never committed (`.ruff_cache/`, `.tmp-*/`, `.openclaw*`). `.serena/project.yml` is maintained project configuration.
- Persona or template files (`IDENTITY.md`, `SOUL.md`, `USER.md`) are local-only and must be gitignored.
- `GEMINI.md` is an import-only entry point (`@AGENTS.md`) and is allowlisted. A second contract file whose rules conflict with `AGENTS.md` is removed after its live rules are merged into `AGENTS.md` or an ADR.
- Linter/formatter configs have one owner. Biome owns lint and format; a second linter config (`.oxlintrc.json`) is removed while its tool is not installed.
- Python tooling entry points live in `scripts/`; generated reports and research inputs live under `data/` or `runs/`. `research/` is the one allowlisted exception: it is the output path hardcoded by the pinned reusable weekly workflow (`.github/workflows/weekly-repo-research.yml`), so it stays until that workflow accepts a path input.

## 2. Documentation

- `README.md`: human onboarding only. Links to the maintained boundaries below.
- `AGENTS.md`: agent rules only.
- `docs/QUALITY_GATES.md`: gate ownership only.
- `docs/standard/`: operational standards. One topic per file, kebab-case, dated or versioned only when the standard itself is versioned.
- `docs/adr/`: architecture decisions. Each ADR has a unique number and a status (`Accepted`, `Superseded by NNNN`, `Rejected`).
- `docs/archive/`: superseded or proposal-stage documents, kept for history, never deleted, not linked from the index (see `docs/archive/README.md`).
- Production and issue-note directories are not permanent records. Maintained standards live in `docs/standard/`; closed issue notes are moved to `docs/archive/proposals/` or removed after their outcome is captured in an ADR or Git history.

Rules:

- `docs/adr/README.md` lists every ADR whose status is `Accepted`. Adding or accepting an ADR requires adding it to the index in the same change.
- ADR numbers are unique. A duplicate number is a violation; the later decision takes the next free number.
- Superseded ADRs are removed (the index rule), not kept as history.
- Docs reference only paths that exist. A dead path reference is a violation. The audit checks inline code paths (backticked paths under the root directories) in `README.md`, `AGENTS.md`, and `docs/` outside `docs/archive/`. A path counts as existing when it is tracked or ignored by `.gitignore` (runtime output such as `runs/` or `logs/`).
- Documents describe current executable behavior. A document that names a missing script or task is removed or corrected in the same change.

## 3. Branches and worktrees

- `main` is the only long-lived branch.
- A working branch exists for one outcome. It is merged, or deleted, when that outcome is complete or abandoned.
- Before a branch is deleted, its tip is preserved as an annotated or lightweight tag `archive/<branch>-<YYYYMMDD>`.
- Remote branch deletion and force-push require a listed set of target branches and explicit user approval for that list. Approval for one list does not carry to another.
- Each worktree corresponds to one live branch. Prunable worktrees are removed with `git worktree prune`.
- 作業を branch や git worktree に分解することを禁止する。
- 作業は一つの canonical branch で行い、必要なら同じ branch に commit する。新しい branch / worktree は、ユーザーが明示的に指示した場合のみ作る。
- 完了後は同じ branch を速やかに `main` へ merge する。merge 条件は global rules の Autonomous Merge に従う。

## 4. Uncommitted state

- A session ends with no unexplained uncommitted changes. Each change is either committed on the canonical branch, or reverted with user approval, or gitignored at its source.
- Pre-commit hooks are a single configuration owned by `.pre-commit-config.yaml`. A hook that fails on unrelated pre-existing files is fixed in the hook's scope, not bypassed with `--no-verify`.

## 5. Enforcement

This standard is enforced by `task audit:repo-layout`, which checks the root allowlist, ADR index completeness (every `Accepted` ADR is indexed and every indexed file exists), duplicate ADR numbers, and dead inline doc path references. Branch and worktree counts are checked by reviewers and by the agent before final reporting (AGENTS.md section 7).
