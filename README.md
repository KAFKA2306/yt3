<div align="center">

# 🎬 yt3

**AI-Powered Japanese Finance Video Generator**

[![Python](https://img.shields.io/badge/Python-3.11+-3776ab?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![LangGraph](https://img.shields.io/badge/LangGraph-Workflow-00a67e?style=flat-square)](https://langchain-ai.github.io/langgraph/)
[![Gemini](https://img.shields.io/badge/Gemini-LLM-4285f4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/)

</div>

---

## ⚡ Quick Start

```bash
task bootstrap                    # First-time setup
task run -- --query "FOMC 金利"   # Generate video
```

## 🛠️ Commands

```
task run      │ Run workflow
task check    │ Lint + type check
task up       │ Start services
task down     │ Stop services
task status   │ Check status
```

## 📁 Structure

```
src/
├── agents/    → LangGraph agents
├── graph.py   → Workflow definition
└── main.py    → Entry point

config/        → YAML settings
prompts/       → Prompt templates
runs/          → Generated outputs
```

## ⚙️ Config

| File | Purpose |
|:-----|:--------|
| `config/default.yaml` | Workflow settings |
| `prompts/*.yaml` | Prompt templates |

---

<div align="center">
<sub>Built with LangGraph • Gemini • Voicevox • FFmpeg</sub>
</div>
