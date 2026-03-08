---
name: typescript-zero-fat
description: Enforce zero-fat TypeScript standards — no comments, no any, no try-catch in business logic, no hardcoded values. Use when writing or reviewing TypeScript code in this project. Triggers on any code generation, code review, "write a function", "implement", "refactor", or TypeScript file edits.
---

# TypeScript Zero-Fat Protocol

## Why Zero-Fat

Comments rot. `any` spreads. Defensive code hides bugs. The goal is a codebase where types, names, and structure tell the whole story — no annotations required, no silent failures possible.

## Stack

- **Runtime**: Bun — package management, script execution, testing in one binary
- **Linting**: Biome (Rust-powered, replaces ESLint + Prettier)
- **Validation**: Zod at all system boundaries
- **Type checker**: `tsc --strict` via `bun run typecheck`

## Iron Rules

**No comments or JSDoc.** Code expresses intent through naming, typing, and clean structure. If a comment feels necessary, the code needs refactoring.

**No `any`.** External inputs enter as `unknown` and are validated immediately with Zod. `any` is a type hole — it propagates corruption silently.

**No try-catch in business logic.** Unexpected states crash immediately. The infrastructure (Systemd, Bun test runner) handles recovery. Swallowed exceptions destroy the stack trace and make debugging impossible.

**No hardcoded values.** All parameters come from `config/*.yaml` via `src/io/core.ts`. Hardcodes scatter configuration across files and make environment switching fragile.

**No relative imports.** Use absolute paths from project root to avoid breakage when files move.

## Patterns

**Guard-first logic** — use early returns to flatten nested branches:
```typescript
if (!config.enabled) return
if (!data.length) throw new Error("Empty dataset")
// success path continues here
```

**Zod at boundaries** — validate at entry, trust internally:
```typescript
const Config = z.object({ apiKey: z.string().min(1) })
const config = Config.parse(raw)  // throws clearly if invalid
```

**Schema-validated models everywhere** — no plain objects at system boundaries.
