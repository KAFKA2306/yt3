<div align="center">

# 🎬 yt3

**AI-Powered Japanese Finance Video Generator**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Workflow-00a67e?style=flat-square)](https://langchain-ai.github.io/langgraphjs/)
[![Gemini](https://img.shields.io/badge/Gemini-LLM-4285f4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/)

</div>

---

## ⚡ Quick Start

```bash
task bootstrap            # Install dependencies & sync
task run -- "FOMC 金利"   # Generate video
```

## 🛠️ Commands

```
task run      │ Run workflow
task lint     │ Type check (tsc)
task test     │ Run unit tests
task up       │ Start services (Discord Bot, Voicevox)
task down     │ Stop services
task status   │ Check status
```

## 🧪 Testing & CI

**"Containment" Strategy**:
Tests are designed to be strictly **contained** to prevent any accidental costs or publishing.
- **No LLM**: `SKIP_LLM=true` is enforced. Tests use cached fixtures instead of hitting Gemini API.
- **No Publish**: `DRY_RUN=true` is enforced. No API calls to YouTube/Twitter.

### Local Usage
```bash
task test    # Run all tests (fast, no cost)
```

### What is tested?
1.  **Core Utilities** (`src/core.ts`):
    *   Configuration loading and defaults.
    *   LLM response parsing (JSON/Markdown cleanup).
    *   Fail-fast file reading.
2.  **Agents** (`src/agents/research.ts`):
    *   **Research Step**: mock-execution using fixture data to ensure correct output structure and state updates without external API dependency.


## 📁 Structure

```
src/
├── agents/    → LangGraph agents (Research, Audio, etc.)
├── graph.ts   → Workflow definition (StateGraph)
├── state.ts   → State interfaces
└── index.ts   → Entry point

scripts/       → Automation & Bots
config/        → YAML settings
prompts/       → Prompt templates (YAML)
runs/          → Outputs
```

## 📐 Technical Design

For a deeper dive into the system architecture and logic:

- [**System Architecture**](docs/diagrams/architecture.md): Overview of components, environment, and external service integrations.
- [**System Workflow**](docs/diagrams/workflow.md): Detailed execution pipeline, agent interactions, and media synthesis logic.
- [**Domain Model**](docs/diagrams/domain_model.md): Core data structures and state definitions.

## ⚙️ Config

| File | Purpose |
|:-----|:--------|
| `config/default.yaml` | System & Provider settings |
| `prompts/*.yaml` | Agent Prompts |
| `.env` | API Keys |

---

<div align="center">
<sub>Built with LangGraph.js • Gemini • Voicevox • FFmpeg</sub>
</div>
