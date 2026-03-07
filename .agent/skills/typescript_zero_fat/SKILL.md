---
name: typescript-zero-fat
description: Defines and enforces high-reliability, ultra-fast development standards in TypeScript, mirroring modern Python toolchains (uv, Ruff, Pydantic).
---

# TypeScript Zero-Fat Protocol

**Objective**: Maintain a skeletal, high-performance codebase by eliminating architectural "fat" and enforcing strict type safety and runtime validation.

## 1. The Modern Stack (Tooling)
*   **Runtime & Management (Bun)**: Inheritor of the `uv` philosophy. Consolidate package management, execution, and testing into `bun`.
*   **Static Analysis & Formatting (Biome)**: Equivalent to `Ruff`. Deprecate ESLint/Prettier in favor of the Rust-powered `biome` for near-instant analysis.
*   **Data Validation (Zod)**: Equivalent to `Pydantic`. Synchronize boundary validation and type inference using `zod` schemas.
*   **Type Checker (TypeScript Strict)**: Equivalent to `ty`. Mandatory `strict: true`. Run `bun run typecheck` in CI to prevent regression.

## 2. Zero-Fat Iron Rules (Execution)
1.  **Fail Fast Protocol**: Immediate crash on anomaly. Prohibit opaque `try-catch` blocks that swallow errors. Prefer `process.exit(1)` or unhandled propagation to expose structural flaws.
2.  **Self-Documenting Code**: Code is the documentation. Delete all comments and JSDoc. Intent must be conveyed exclusively through naming and strict typing. Deconstruct complex logic instead of explaining it.
3.  **No Any Policy**: Absolute ban on `any`. Treat external inputs as `unknown` and validate immediately via `Zod` to establish type certainty.

## 3. Implementation Patterns
*   **Configuration Driven**: Absolute prohibition of hardcoded constants. Retrieve all parameters from `config/*.yaml` via `src/io/core.ts`.
*   **Guard-First Logic**: Avoid nested branches. Use early returns (Guard Clauses) to keep the "Success Path" linear and readable.
