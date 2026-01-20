# Source Code Responsibilities (Essential Version)

| File Path | Core Responsibility | Key Logic |
| :--- | :--- | :--- |
| `src/index.ts` | Entry Point | Setup env and run graph. |
| `src/graph.ts` | Orchestrator | Direct 4-agent linear flow. |
| `src/state.ts` | State | Global data interfaces. |
| `src/models.ts` | Models | Shared domain models. |
| `src/config.ts` | Config | Provider and prompt loading. |
| `src/asset.ts` | Storage | Run-specific asset management. |
| `src/utils.ts` | Parsers | Standardized LLM result processing. |
| `src/step.ts` | CLI | Granular stage execution. |
| `src/agents/base.ts` | Foundation | Minimal LLM wrapper. |
| `src/agents/research.ts` | Research | Memory novelty + single-turn web research. |
| `src/agents/content.ts` | Content | Single-turn script & SEO generation. |
| `src/agents/media.ts` | Production | Automated TTS, image, and video assembly. |
| `src/agents/publish.ts` | Distribution | Multi-platform publishing. |

---

## Minimalist Principles
1. **No Redundancy**: Functions are not duplicated.
2. **No Defensive Code**: No comments, `if`, `try`, or `fallback` logic.
3. **Strong Focus**: Each agent does exactly one high-level task in minimum steps.
4. **Structural Automation**: Global state managed strictly by `graph.ts`.
