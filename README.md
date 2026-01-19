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
