---
name: env-management
description: Enforce strict environment variable management rules for .env and project configurations. Requires mandatory invocation before all env-related tasks.
---

# Environment Management Skill (MANDATORY HOOK)

## Position in Workflow
- **Phase**: Research / Plan (Pre-flight configuration audit)

## 📋 Rationale for Strategic Shift
1. **Zero-Leakage Security**: Prohibiting placeholders and mandating strict `.env` auditing prevents accidental exposure of sensitive API keys (e.g., GEMINI_API_KEY) in logs or source control.
2. **Reliable Initialization**: By enforcing mandatory variable presence at startup, we eliminate runtime failures caused by missing configuration, ensuring the system fails fast and loud.
3. **Canonical Configuration**: Establishing a single source of truth for all environment variables prevents shadowing and conflicts between different providers (e.g., Google vs. Gemini keys).

---

## 📝 Governance Rules
1.  **NO Placeholders**: Never use `your_key_here` or similar strings in `.env` files. If a key is missing, the system MUST fail immediately.
2.  **Strict Loading**: Always use `bun --env-file=config/.env` or explicit `dotenv` loading for all entry points.
3.  **Variable Shadowing Prohibition**: Prohibit shadowing critical variables. Use a single source of truth (e.g., `GEMINI_API_KEY` for all Gemini-related tasks).
4.  **Round-Robin Pool Convention**: 
    - Multiple Gemini keys MUST be named `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, ..., `GEMINI_API_KEY_[N]`.
    - `GEMINI_API_KEY` (no index) is treated as an alias for `GEMINI_API_KEY_1`.
5.  **Audit Before Execution**: Before any logic execution, verify that all mandatory variables defined in `src/domain/types.ts` are present.

## 🚀 Execution Protocol
- **Audit**: Run `cat config/.env` to verify keys exist without actually exposing their full values in logs (use `grep` for keys).
- **Verify**: Use a diagnostic script (e.g., `src/io/utils/check_env.ts` or `llm-round-robin/scripts/check_keys.ts`) to confirm API connectivity before starting heavy pipelines.
- **Fail Fast**: If a key is invalid or missing, do NOT attempt to fallback. Terminate the process with a clear error message.

## 🔐 Security Integrity
- Ensure `.env` is never committed to git by maintaining its entry in `.gitignore`.
- Treat environment variables as highly sensitive and never log their literal values.

## ⚠️ Local LLM (Qwen3.5-9B) Constraints
- **4096 Token Limit**: Prune environment audit logs to the minimum required for verification. DO NOT output full `.env` content.
- **Redundancy Prohibition**: Output ONLY the status of missing/invalid keys. DO NOT repeat successfully verified keys.

## 🚫 Negative Constraints (MANDATORY)
- **DO NOT** commit `.env` files to version control.
- **DO NOT** use placeholder values (e.g., `TODO`, `FIXME`, `REPLACE_ME`).
- **DO NOT** fallback to default keys if environment-specific keys are missing.
- **DO NOT** log plain-text secret values.
