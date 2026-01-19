# Repository Guidelines

**Strict Clean Architecture & Graph-Centric Design**

コードベースの最小化と信頼性を最優先する。エラーハンドリング禁止。抜本的な課題を解決。コメント禁止。最小のコードにしつつ、目標を達成する。
DRYの原則に準拠。configファイル (`config/default.yaml` および `prompts/*.yaml`) を変更するだけで、意図通りに全体の動作が変更できなければならない。
ハードコーディング禁止。`src/config.py`経由で設定を読み込むこと。
ROOTにファイルを生成しない。適切なディレクトリに追加していく。使い捨てのコードを生成しない。無用なテストを削除する。

## Project Structure

- **src/**: Core application logic.
    - `main.py`: CLI entry point.
    - `graph.py`: LangGraph `StateGraph` definition.
    - `models.py`: Pydantic data models.
    - `state.py`: `AgentState` TypedDict definition.
    - `config.py`: Configuration and prompt loader.
    - `utils.py`: Minimal utilities.
    - `agents/`: LangGraph agent implementations.

- **config/**: YAML configuration.
    - `default.yaml`: Application settings.

- **prompts/**: Prompt templates (YAML).
    - `trend.yaml`, `director.yaml`, `knowledge.yaml`, `script.yaml`, `news.yaml`

- **scripts/**: Automation scripts.

## Build & Run

- `task bootstrap` — complete setup.
- `task run` — run workflow: `task run -- --query "Topic"`
- `task check` — linting.
- `task up/down` — start/stop services.

## Coding Rules

1. **No Comments**: Self-explanatory code only.
2. **Config-Driven**: Use `src.config.load_prompt()` and `src.config.load_config()`.
3. **No Error Handling**: Fail fast.
4. **Pure Functions**: Nodes should be stateless.

## Technologies

- **LangGraph**: Workflow orchestration.
- **Gemini**: LLM for generation.
- **Voicevox**: TTS engine.
- **FFmpeg**: Video rendering.
