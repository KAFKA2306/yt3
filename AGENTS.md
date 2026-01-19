# Repository Guidelines

**Strict Clean Architecture & Graph-Centric Design**

コードベースの最小化と信頼性を最優先する。エラーハンドリング禁止。抜本的な課題を解決。コメント禁止。最小のコードにしつつ、目標を達成する。
DRYの原則に準拠。configファイル (`config/default.yaml` および `prompts/*.yaml`) を変更するだけで、意図通りに全体の動作が変更できなければならない。
ハードコーディング禁止。`src/config.py`経由で設定を読み込むこと。
ROOTにファイルを生成しない。適切なディレクトリに追加していく。使い捨てのコードを生成しない。無用なテストを削除する。

## Project Structure

- **src/**: Core application logic.
    - `main.py`: CLI entry point initializes and runs the graph.
    - `graph.py`: LangGraph `StateGraph` definition.
    - `models.py`: Pydantic data models (`NewsItem`, `Script`, etc.).
    - `state.py`: `AgentState` TypedDict definition.
    - `config.py`: Configuration and prompt loader.
    - `utils.py`: Minimal utilities (LLM parsing).
    - `nodes/`: Pure function graph nodes (`research`, `script`, `audio`, `video`).
    - `rag/`: Haystack 2.0 components (`PerplexityFetcher`) and pipelines.

- **config/**: System configuration.
    - `default.yaml`: Application settings (URLs, models, video params).

- **prompts/**: Prompt Templates.
    - `news.yaml`: News collection prompts.
    - `script.yaml`: Script generation prompts and persona definitions.

- **scripts/**: Automation and maintenance scripts (`discord_news_bot`, `automation.py`).
- **outputs/**: Generated artifacts (audio, video, script).

## Build & Run

### Using Task Runner
- `task bootstrap` — complete setup (deps + services).
- `task run` — run the main workflow: `task run -- --query "Topic"`
- `task check` — linting (`uv run ruff check`).
- `task up/down` — start/stop background services (Voicevox, Aim, Discord).

### Manual
- `uv sync`
- `uv run python -m src.main --query "Topic"`
- `uv run ruff check src`

## Coding Rules

1.  **No Comments**: Code must be self-explanatory. Docstrings only for complex interface usage if absolutely necessary (but prefer none).
2.  **Config-Driven**: 
    - No hardcoded prompts. Use `src.config.load_prompt("name")`.
    - No hardcoded URLs/Models. Use `src.config.load_config()`.
3.  **No Error Handling**: Fail fast. Let the orchestrator or user handle failures. No `try-except` blocks.
4.  **No Deep Hierarchies**: Keep structure flat where possible (`src/nodes`, `src/rag`).
5.  **Pure Functions**: Nodes should be stateless functions taking `AgentState` and returning a dict update.

## Technologies

- **LangGraph**: Workflow orchestration.
- **Haystack 2.0**: RAG pipeline (News Collection).
- **Gemini**: LLM for script generation.
- **Voicevox**: TTS engine.
- **FFmpeg**: Video rendering.
