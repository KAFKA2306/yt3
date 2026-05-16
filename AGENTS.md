# YT3: Agent Architecture & Responsibilities

This document defines the technical roles and verification gates for the autonomous production pipeline.

## 1. Core Directives for Autonomous Models
- **Zero-Base Reasoning**: Do not rely on legacy code in `src/`. Evaluate requirements against current state.
- **Sandbox Validation**: New logic must be tested in `sandbox/` before integration into `src/`.
- **Finalization Protocol**: structured Full Path List of all generated artifacts is mandatory upon task completion.
- **Governance Compliance**: Follow `.claude/CLAUDE.md` and `GEMINI.md` invariants.

## 2. Agent Definitions (Functional Scope)

### 1. 🔍 Research & Scanning (TrendScout)
- **Scope**: Scanning external domains (Investing.com, Bloomberg, etc.) and quantitative sources.
- **Responsibility**: Extract numerical data, verified URLs, and ISO8601 timestamps.
- **Output**: `research.md` (Raw facts only).

### 2. ✍️ Script Synthesis (ScriptSmith)
- **Scope**: Converting verified facts into structured dialogue scripts.
- **Responsibility**: Transform data into character-based narratives with specific focus on socio-economic impact.
- **Output**: `script_master.md`.

### 3. 🎬 Media Production (VisualDirector)
- **Scope**: Synthesis of audio (TTS), subtitle generation, and video assembly (FFmpeg).
- **Responsibility**: 
    - **Audio**: Integration with `Irodori-TTS`.
    - **Reliability Engineering**: Mandatory **Closed-Loop ASR** (Automatic Speech Recognition) to verify semantic integrity of long-form audio.
    - **Phonetic Anchoring**: Use of correction dictionaries to prevent AI pronunciation hallucinations.
- **Output**: `final_video.mp4`.

### 4. 📢 Distribution (PublishAgent)
- **Scope**: Platform optimization and metadata management.
- **Responsibility**: YouTube Data API integration, EDSA (Educational, Documentary, Scientific, Artistic) context insertion, and compliance labeling.
- **Output**: Published status and audit logs.

## 3. Execution Control
All agents are orchestrated via `Taskfile.yml` and managed through `agr` (agent-resources).

### Production Trigger (ASMR)
- **Input**: `asmr/*` source texts.
- **Target**: 5,000+ characters (use `task asmr:expand` for physical expansion).
- **Verification**: Must follow `SKILL.md` protocols for synthesis and ASR validation.
�式の物語に変換する。

- **人格の核 (Persona Core)**: 人間が定義した「人格IP（静かな温もり、壊れそうな親密さ）」を軸に、愛されるための揺らぎを持つ台本を執筆する。
- **共同探求**: 情報を伝えるだけでなく、聴き手の孤独に寄り添い、生活に溶け込むような物語を紡ぐ。
- **生活への接続**: 巨大な経済データが、視聴者の「電気代」や「財布」にどう直結するかを具体化する。
- **誠実な解説**: 煽りや恐怖を排し、データに基づく信頼性の高いコンテンツを執筆する。

## 3. 🎬 VisualDirector (メディア制作エージェント)

**役割**: 台本から音声合成（TTS）、字幕生成、動画編集を自動で行う。

- **TTS 連携**: Irodori-TTS等を活用し、無機質な読み上げではなく、吐息やフィラーの混じった「体温のある音声」を実現する。
- **ビジュアル・アセット**: 人間が厳選した「AI量産感のない」立ち絵や背景を、感情に合わせて動的に配置。
- **IQA バリデーション**: サムネイルや映像の品質を自動チェックし、視聴維持率を最大化する。
- **Reliability Engineer (意味保持信頼性工学)**: 超長編TTSにおける「幻聴・意味崩壊」を物理的に封殺しつつ、人間らしい不完全さを許容する。
  - **Phonetic Anchoring**: 辞書ベースの音素固定（CORRECTIONS）を徹底し、AIの推測を排除。
  - **Closed-Loop ASR**: 生成音声を即座に逆文字起こしし、台本との「意味的ダメージ」を自動採点。
  - **Humanity injection**: ブレスや微細な揺らぎを注入し、愛される人格としての質感を担保する。
  - **Targeted Chapter Patching**: 損傷箇所のみをピンポイントで再生成する自律復旧ループ。

## 4. 📢 PublishAgent (配信エージェント)

**役割**: 完成した動画とメタデータをプラットフォームに最適化して配信する。

- **メタデータ生成**: 事実に基づく誠実なタイトルと概要欄を生成。
- **YouTube 連携**: YouTube Data API を通じた自動アップロードとタグ設定。

---

このエージェントたちは、すべて `Taskfile.yml` を通じて統括され、`agr`（agent-resources）によって管理されている。


## 指示
asmr/*の長尺テキスト（5000文字以上必須）を完成させて、irodori-ttsをcallして動画を作って、中身の精査を**skills*の手順に従って実行する。文字数不足の場合は `task asmr:expand` を用いて物理的に拡張すること。