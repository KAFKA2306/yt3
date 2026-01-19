# Repository Guidelines

**Strict Clean Architecture & Graph-Centric Design**

コードベースの最小化と信頼性を最優先する。エラーハンドリング禁止。抜本的な課題を解決。コメント禁止。最小のコードにしつつ、目標を達成する。
DRYの原則に準拠。configファイル (`config/default.yaml` および `prompts/*.yaml`) を変更するだけで、意図通りに全体の動作が変更できなければならない。
ハードコーディング禁止。`src/config.ts`経由で設定を読み込むこと。
ROOTにファイルを生成しない。適切なディレクトリに追加していく。使い捨てのコードを生成しない。無用なテストを削除する。

## Project Structure

- **src/**: Core application logic.
    - `index.ts`: Entry point.
    - `graph.ts`: LangGraph `StateGraph` definition.
    - `models.ts`: Zod schemas & Types.
    - `state.ts`: `AgentState` interface.
    - `config.ts`: Configuration, Prompt loader, LLM Factory.
    - `utils.ts`: Parsers and helpers.
    - **agents/**:
        - `base.ts`: **BaseAgent** (Shared LLM logic).
        - `director.ts`: **DirectorAgent** (Strategy/Research).
        - `reporter.ts`: **ReporterAgent** (Web Search/News).
        - `script.ts`: **ScriptAgent** (Content Generation).
        - `audio.ts`, `video.ts`: Media processing.

- **config/**: YAML configuration.
    - `default.yaml`: Application settings.

- **prompts/**: Prompt templates (YAML).
    - `director.yaml`: Strategy prompting.
    - `reporter.yaml`: Search extraction.
    - `script.yaml`: Script generation.

- **scripts/**: Automation & Bots (TypeScript).
    - `tasks.ts`: Task runner.

## Build & Run

- `task bootstrap` — complete setup (npm install).
- `task run` — run workflow: `task run -- "Topic"`
- `task lint` — type check (`tsc`).
- `task up/down` — start/stop services.

## Coding Rules

1. **No Comments**: Self-explanatory code only.
2. **Config-Driven**: Use `loadPrompt()` and `loadConfig()`.
3. **Fail Fast**: No redundant `try-catch` blocks. Let errors bubble up.
4. **Inheritance**: All LLM agents MUST extend `BaseAgent` to reuse logic.
5. **Pure Functions**: Graph nodes should be stateless wrappers around Agents.

## Technologies

- **LangGraph.js**: Workflow orchestration.
- **Gemini**: LLM for generation (via `BaseAgent`).
- **Voicevox**: TTS engine.
- **FFmpeg**: Video rendering.
