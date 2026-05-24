---
name: engineering-standards
description: Integrates development and operational standards. Covers environment variable audits, type safety, hook compliance, harness verification, Discord operations, and pre-development process management under Zero-Trust and Crash-Driven philosophies.
type: skill
---

# Engineering Standards

## Objective

Maintain implementation quality and operational reproducibility across all channels.

## Required Paths

- Root: `/home/kafka/2511youtuber/v3/yt3`
- Environment Variables: `/home/kafka/2511youtuber/v3/yt3/config/.env`
- Architecture Decisions: `/home/kafka/2511youtuber/v3/yt3/docs/adr/`
- Claude Settings: `/home/kafka/2511youtuber/v3/yt3/.claude/settings.json`
- Discord Webhook: `/home/kafka/2511youtuber/v3/yt3/src/io/utils/discord.ts`
- Discord Bot: `/home/kafka/2511youtuber/v3/yt3/src/agents/standalone/discord_bot.ts`
- Pre-plan Output: `/home/kafka/2511youtuber/v3/yt3/temp/plan.md`

## Formatters & Verifiers

- Format: `bun run format`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- Harness Doctor: `task harness:doctor`
- Env Validation: `bun run src/io/utils/check_env.ts`
- Service Status: `task status`

## Zero-Trust Audit Architecture Principles (Mandatory)

1. **No Evidence, No PASS**: Never trust LLM summaries, self-reporting logs, or "success-like" prints. A PASS status must be strictly bound to machine-verifiable evidence (hashes, exit codes, artifact files, schema validations, trace logs).
2. **Generator-Verifier Separation**: The generating agent must never audit its own output. Always use independent verifiers or deterministic validators.
3. **Fail Loudly & Crash-Driven**: Silent fails, warnings-only, and fallbacks are strictly prohibited. The system must crash immediately (Crash-Driven Development) upon detecting any invariant violation.
4. **Boundary Isolation**: Ensure complete segregation between Byousan Money, Yawa Archive, and Humanity Observatory. Verify speaker roles, config files, and publishing channels to prevent cross-domain contamination.
5. **Runtime & Artifact-Centric Auditing**: Do not assume code works because it exists. Always verify at runtime (e.g., execute subprocesses, decode mp4/wav with ffmpeg, perform automated speech recognition) and inspect actual generated artifacts.

## Preflight Destructive Command Harness (Mandatory)

1. **Direct Destructive Commands Forbidden**: Do NOT run destructive commands directly in the shell. Destructive commands include:
   - `git clean`
   - `git restore`
   - `git reset`
   - `rm`
   - `mv`
   - `checkout`
   - Any command overwriting `db/prompts.json`
   - Any command deleting files under `artifacts/`

2. **Execute Harness First**: Before executing any command matching the patterns above, you MUST run the safety harness script `./scripts/guard_destructive.sh`.
3. **Use Safe Git Clean**: Never run `git clean -fd` directly. You must run `./scripts/safe_git_clean.sh` to perform a dry-run check.
4. **Zero Reasoning Exemption**: You are not allowed to claim safety through verbal reasoning or LLM self-report. A "PASS" status is valid only if produced via the script's exit code `0`. If the script exits with code `1`, you must report the evidence path and file list, and immediately stop execution (Fail Loudly).
5. **Agent Contract**:
   - Destructive command must be wrapped.
   - Evidence directory must exist before action.
   - PASS/FAIL must be produced by script exit code.
   - If FAIL, agent may only report evidence path and file list.
   - Agent must not summarize deleted files as recoverable unless file exists on disk.

## Development Workflow

1. Prior to any code change, verify required keys exist in `/home/kafka/2511youtuber/v3/yt3/config/.env`.
2. Document architectural decisions in `/home/kafka/2511youtuber/v3/yt3/docs/adr/` before execution.
3. Record compared alternative designs and selected plan in `/home/kafka/2511youtuber/v3/yt3/temp/plan.md`.
4. Apply code changes, then run format, lint, and typecheck commands.
5. Execute `task harness:doctor` and resolve all warnings.
6. Verify Discord webhook setup and test notification channels via `task up` and `task status`.
7. Terminate services with `task down` when finished.
8. Resolve issues by modifying the code directly rather than altering hook settings.

