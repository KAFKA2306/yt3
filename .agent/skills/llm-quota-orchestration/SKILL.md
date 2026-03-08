---
name: llm-quota-orchestration
description: UNIVERSAL PATTERN for high-availability LLM clusters. Implements Quota Observation, Sticky Affinity, and Tiered Resilience to optimize throughput, latency (via caching), and reliability across multiple API providers or local models.
---

# Universal LLM Quota Orchestration (The Cluster Pattern)

## 📋 Core Architectural Principles

### 1. Quota Observation (Real-time Feedback Loop)
* **Reactive Scaling**: Systems MUST intercept rate-limit metadata (e.g., `x-ratelimit-remaining`, `x-ratelimit-reset`) from every API response.
* **State Ledger**: Maintain a centralized, persistent state (The Ledger) to track health, remaining capacity, and cooldown windows for all nodes in the cluster.
* **Proactive Isolation**: Immediately isolate nodes hitting 429 errors or low-quota thresholds to protect the overall system's stability.

### 2. Sticky Affinity (Cache Optimization)
* **Session Persistence**: Pin specific workflows or long-running tasks to a single cluster node (Sticky Session) to maximize **Prefix/Prompt Caching** benefits.
* **Affinity Breach**: Only migrate a session to a new node if the current node's health degrades (e.g., 429 error), prioritizing availability over cache efficiency in critical failures.

### 3. Tiered Resilience Hierarchy
* **Tier 1 (Cloud Cluster)**: Parallel execution across multiple API keys/projects for maximum performance and context window.
* **Tier 2 (Local Fallback)**: Automated transition to self-hosted models (vLLM/Ollama) when cloud quotas are exhausted.
* **Tier 3 (Fail Fast)**: Immediate termination with diagnostic state preservation if all tiers are depleted, allowing external supervisors (Systemd/Cron) to manage recovery.

### 4. Situation Awareness (Agent-Centric Guidance)
* **Contextual Injection**: Inject `[LLM System Status]` into the final system prompt. This MUST include current provider, remaining quota, and strategic guidance.
* **Adaptive Reasoning**: Sub-agents MUST adjust their output verbosity and reasoning depth based on the injected status (e.g., "Standard" for Cloud vs. "Extreme Conciseness" for Local 4k-context models).

## 🚀 Execution Standards

### 1. The Pre-flight Protocol (Acquisition)
* Before invocation, the orchestrator MUST select the "Healthiest" node:
  - **Match Affinity**: Check for an existing session-to-node mapping.
  - **Highest Capacity**: If no affinity exists, select the node with the highest remaining quota.
  - **Load Balancing**: If quotas are equal, utilize a "Least Recently Used" (LRU) selection.

### 2. The Post-flight Protocol (ledger Update)
* After invocation, the orchestrator MUST update the ledger:
  - **Metadata Extraction**: Parse headers or error messages for quota reset times.
  - **Cooling Down**: Mark exhausted nodes with a mandatory wait period (e.g., Reset Time + Buffer).

### 3. Monitoring & Evolution
* **Audit Trails**: Log every key rotation and fallback event with latency and success/failure metrics.
* **Strategic Pruning**: Utilize evaluation cycles (e.g., ACE Intelligence) to prune consistently failing nodes from the cluster.

## 🔐 Integrity & Security
* **No Secret Exposure**: Log ONLY non-sensitive identifiers (indices, aliases, or truncated hashes). Raw keys must NEVER be persisted in logs or state files.
* **Strict Configuration**: Enforce standardized naming conventions for API resources to ensure seamless discovery and validation.
