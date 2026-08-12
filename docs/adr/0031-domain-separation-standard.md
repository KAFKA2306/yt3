# ADR 0031: ドメイン境界管理および共通処理の設計仕様

## 📝 プロベナンス表示 (Claim Provenance)
- **VERIFIED**: `src/index.ts`, `src/io/core.ts`, `src/domain/agents/audit.ts`, `Taskfile.yml` を確認。境界バリデーションの強制とバケット分離ロジックの実装を検証済み。
- **OBSERVED**: 「秒算マネー」「夜話アーカイブ」「人類観測所」の3ドメインにおける設定・アセット・環境変数の混在リスクを特定。
- **INFERRED**: 環境変数の漏洩や誤投稿を防ぐには、ワークフロー初期化時および監査フェーズでの決定論的な境界チェックが不可欠である。

## 状態
決定済み（Accepted）

## 文脈
yt3リポジトリは「秒算マネー」「夜話アーカイブ」「人類観測所」の3つの異なるドメインを内包する。これらはブランド倫理、話者設定、アセット配置、YouTube配信先が完全に異なる。事故（クロスコンタミネーション）を防止し、プラットフォームの堅牢性を維持するための境界管理ルールを定義する。

## 決定事項

### 1. ドメイン定義とアセット配置の完全隔離
各ドメインのアセットおよび実行結果（Runs）は、以下のパスに厳格に隔離する。

| チャンネル名 | ドメイン種別 | 主要話者 | アセット・Runs パス |
| :--- | :--- | :--- | :--- |
| **秒算マネー** | Data-Driven Macro | つむぎ, ずんだもん, 玄野 | `runs/daily_pulse/{YYYY-MM-DD}/` |
| **夜話アーカイブ** | ASMR / Whisper | シリーズ別キャスト | `asmr/yawa-archive/{series-name}/` |
| **人類観測所** | Humanity / Essay | 玄野 | `runs/humanity_observatory/{YYYY-MM-DD}/` |

### 2. 層状分離（Platform vs Domain）
コードベースを共通基盤とドメイン固有ロジックに分離する。
- **共通プラットフォーム層**: `src/io/core.ts` (Config, LLM, AssetStore), `src/workflow.ts` (Sequence Control)。ドメイン固有のハードコードを禁止する。
- **ドメイン固有ロジック層**: `src/humanity_observatory_workflow.ts`, `src/domain/agents/` 内部の分岐処理。`bucket` 引数に基づき、プロンプトやアセットを動的に切り替える。

### 3. 設定値と環境変数の隔離
- **.env ファイル**: `config/.env` (Default/Humanity), `config/.env.byosan` (Byousan), `config/.env.yawa` (Yawa) に分離。
- **実行時の強制**: `Taskfile.yml` にて `ENV_FILE` を明示。`src/io/core.ts` は `dotenv.config({ override: true })` により、指定された環境変数を最優先でロードする。
- **プロンプト名前空間**: `config/default.yaml` 内で `prompts.content` と `prompts.humanity_observatory` を完全に分離する。

### 4. 決定論的境界監査 (Boundary Verification)
境界汚染を検知するため、以下のチェックを強制する。

1. **初期化時のバリデーション**: `src/index.ts` にて `BUCKET` と `RUN_ID` のプレフィックス一致を検証。不一致時は例外を投げ、プロセスを即座に停止（Crash-Driven）させる。
2. **話者整合性チェック**: ドメインごとに許可された話者リストと、スクリプト・音声マニフェストを照合。
3. **アセット整合性**: 各ドメインの定義済みデザイン・トークン（背景色、ロゴ等）と出力物のメタデータを照合。

## 帰結
- **利点**: ドメインの完全分離により、誤投稿リスクを構造的に排除。コードの可読性とメンテナンス性が向上した。
- **代償**: 新規ドメイン追加時に、設定ファイルと分岐ロジックの厳格な定義が必要となる。
