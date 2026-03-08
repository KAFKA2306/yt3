---
name: typescript-zero-fat
description: Defines and enforces high-reliability, ultra-fast development standards in TypeScript, prioritizing zero-fat architecture and strict type safety.
---

# TypeScript Zero-Fat Protocol

## Position in Workflow
- **Phase**: Code / Review (Implementation standards)

## 📋 Rationale for Strategic Shift
1. **Architectural Minimization**: By eliminating "fat" (redundant logic, excessive comments, unused dependencies), we maintain a skeletal, high-performance codebase that is easier to audit and maintain.
2. **Deterministic Reliability**: Mandating strict Zod-based boundary validation and "Fail Fast" protocols prevents runtime anomalies and ensures that all data flowing through the system is type-certain.
3. **Optimized Developer Velocity**: Utilizing high-speed, modern tooling (Bun, Biome) reduces analysis time to near-zero, allowing for rapid iteration without sacrificing quality.

---

## ⚡ The Modern Stack (Standardization)
*   **Runtime & Management (Bun)**: CONSOLIDATE package management, script execution, and testing into a single, high-performance binary.
*   **Static Analysis & Formatting (Biome)**: DEPRECATE ESLint/Prettier. USE Rust-powered linting and formatting.
*   **Data Validation (Zod)**: USE Zod schemas to bridge the gap between static types and runtime validation.
*   **Type Checker (TypeScript Strict)**: MANDATORY `strict: true`. USE `bun run typecheck` to prevent regressions.

---

## ⚡ Zero-Fat Iron Rules (Execution)
1. **Fail Fast Protocol**: ABSOLUTE BAN on defensive `try-catch` blocks that swallow errors. PREFER `process.exit(1)` or unhandled propagation to expose structural flaws.
2. **Self-Documenting Code**: CODE IS THE ONLY SOURCE OF TRUTH. DELETE all comments and JSDoc. EXPRESS intent through naming, strict typing, and clean deconstruction.
3. **No Any Policy**: PROHIBIT `any` usage. TREAT external inputs as `unknown` and VALIDATE immediately via Zod.

## 🏗 Implementation Patterns
*   **Configuration Dominance**: PROHIBITION of hardcoded constants. All parameters MUST be retrieved from `config/*.yaml` via `src/io/core.ts`.
*   **Guard-First Logic**: USE early returns (Guard Clauses) to eliminate nested branches and maintain a linear, readable "Success Path."
*   **Schema-Validated Models**: All data structures MUST use Zod-validated models. No plain objects or dicts are allowed at system boundaries.

## ⚠️ Local LLM (Qwen3.5-9B) Constraints
- **4096 Token Limit**: PRUNE boilerplate code. DO NOT output redundant type definitions if they are available in existing files.
- **Redundancy Prohibition**: OUTPUT ONLY the modified/new code. DO NOT provide redundant explanations of standard TypeScript syntax.

## 🚫 Negative Constraints (MANDATORY)
- **DO NOT** use `any`.
- **DO NOT** include JSDoc or comments in the final code.
- **DO NOT** hardcode environment variables or API keys.
- **DO NOT** use defensive `try-catch` blocks in business logic.
- **DO NOT** use relative paths for imports.
- **DO NOT** output more than 200 lines of code in a single turn when targeting local models.
