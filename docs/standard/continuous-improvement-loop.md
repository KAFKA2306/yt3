# 💖 継続的改善ループ (Continuous Improvement Loop) 💖

このドキュメントは、YT3の運用ループを固定して、再現性、成功率、自律性、多様性、そして動画のクオリティをずーっと測定＆チューニングできるようにするためのルールだよっ！✨

## 🌸 目的 (Purpose)

- 実行フローを安定させて、毎週の実行結果をちゃんと比較できるようにするよっ！
- タスクの終了コード（Exit Code）だけじゃなくて、しっかり証拠（Evidence）をもとに成功を判定するよっ！
- 変数を1回に1つだけ変更して、改善やデグレードの原因を特定しやすくするんだよ✨
- `agy`やこれからの自動化ツールが同じプレイブックで動くように、ループを機械可読にするよっ！💕

## 🏗️ 3層の改善アーキテクチャ (Three-Layer Architecture) 💖

このプロジェクトでは、ループ構造を以下の3つの階層に分けて設計・管理しているよっ！✨

1. **実行層 (Execution Layer) ➔ `agent loop`**
   - モデル出力とツール実行を繰り返す、一番ミクロな実行単位だよ！`tool_use` と `tool_result` を交互に処理しながら、自律的にタスクを進めるんだっ☆
2. **検証層 (Verification Layer) ➔ `closed-loop agent workflow`**
   - 生成された成果物が仕様を満たしているか、動的・静的チェッカーやLinter（Discomfort Linterなど）で厳しくガードする階層だよ！フィードバックをモデルに戻して、合格するまで自己修正させるクローズドループを構成するよ♪
3. **継続改善層 (Continuous Improvement Layer) ➔ `agent improvement loop / harness design`**
   - 実行ログやエビデンス（`run_evidence.json`）を回収して、システム全体のメトリクス（成功率や再現性）をマクロに測定するよ！測定されたギャップをもとに、プロンプトやツール、検証ルール（Harness）そのものをアップデートして、全体の知性を引き上げるループだよっ！✨

## 🔁 ループエンジニアリング (Loop Engineering)

ループエンジニアリングは、LLMを単発の生成器として扱わず、モデル出力、ツール実行、検証、フィードバック、評価、実装変更をひとつの反復系としてつなぐ設計実践だよっ！

- 実行層は `agent loop` として扱うよ。
- 検証層は `closed-loop agent workflow` として扱うよ。
- 継続改善層は `agent improvement loop` / `harness design` として扱うよ。

- OpenAI Agents SDK の runner は、`final_output`、`handoff`、`tool calls`、`max_turns` を持つ実行ループとして動くよ。
- Anthropic Claude の tool use は、アプリケーションが `tool_use` を実行し、その結果を `tool_result` として Claude に返す agent loop だよ。
- OpenAI Cookbook の improvement loop は、`traces`、`feedback`、`evals`、`Codex handoff` で harness changes を導く improvement flywheel だよっ！

### 参考資料

- [OpenAI Agents SDK: Running agents](https://openai.github.io/openai-agents-python/running_agents/)
- [Anthropic: Tool use with Claude](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)
- [Anthropic: Computer use tool](https://docs.anthropic.com/en/docs/build-with-claude/computer-use)
- [OpenAI Cookbook: Build an Agent Improvement Loop with Traces, Evals, and Codex](https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop)
- [OpenAI API: Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)

このリポジトリでは、この定義を `task improve:report`、`logs/improvement_report.md`、`logs/stability_summary.md`、`logs/daily_guarantee_status.md` で運用ループに落としているよ。

## 🎀 カノニカルなエントリーポイント (Canonical Entry Points)

- `task improve:report`：改善ループ用のレポートを生成するよ！
- `task daily:report`：日次のレポートを更新するよっ！
- `task movie:status`：動画のステータスを確認するよ！
- `task audit:today`：今日のシステム監査をするよ！
- `task byosan:daily`：鋭角ニュース選定から制作、検証、秒算マネー公開証跡までを実行するよ！

## 🔍 真実のソース (Sources Of Truth)

- `logs/agent_activity.jsonl`
- `logs/daily/*.log`
- `logs/stability_summary.md` / `logs/stability_summary.json`
- `logs/stability_ready.md` / `logs/stability_ready.json`
- `logs/daily_guarantee_status.md` / `logs/daily_guarantee_status.json`
- `logs/public_visibility_audit.md` / `logs/public_visibility_audit.json`
- `logs/movie_status.md` / `logs/movie_status.json`
- `logs/improvement_report.md` / `logs/improvement_report.json` ✨（新しく追加されたよ！）
- `runs/<bucket>/<date>/run_evidence.json`
- `runs/<bucket>/<date>/audit/report.json`
- `runs/<bucket>/<date>/audit/creative_freshness_report.json`
- `runs/<bucket>/<date>/publish/receipt.json`

## 🚀 固定されたフロー (Fixed Flow)

1. スコープを固定するよ！
2. ベースラインを記録するよっ！
3. カノニカルなレポートタスクを実行するよ！
4. 証拠（Evidence）から成功と失敗を分類するよ！
5. 変数を1つだけ更新するよっ！
6. 再実行して結果を比較するよ！
7. 学んだレッスンをメモリに保存するよ💕

## 🛡️ 成功のルール (Success Rules)

- ワークフローが完了し、必要な証拠が存在する場合のみ成功と判定するよ！
- 公開証明や実行証拠が欠けている場合、`TASK_DONE`だけでは成功とは見なさないよっ！
- フォールバックコンテンツや、ブロックされた公開は成功にカウントしちゃダメだよ！
- `run:humanity` の厳格な成功条件：
  - `TASK_DONE`
  - `run_evidence.json` が存在する
  - 監査に合格する
  - 公開が予定されている場合は公開証明が存在する
- `byosan:daily` の厳格な成功条件：
  - `TASK_DONE`
  - `run_evidence.json` が存在する
  - `audit/production_quality_report.json` が全件PASS
  - `publish/receipt.json`、公開可視性、サムネ反映証跡がそろう
  - 同日重複公開がない

## 📊 メトリクス (Metrics)

### 1. 成功率 (Success Rate)
- 定義：予定された実行数のうち、成功した実行の割合だよっ！
- 推奨される集計期間：7日間および30日間。
- 生の終了コードではなく、上記の厳格な成功ルールを使用するよ！

### 2. 再現性スコア (Reproducibility Score)
- 定義：同じ入力、設定、プロンプトのスナップショットから、どれだけ実行を再現できるかだよ！
- 最小限のシグナル：
  - `run_evidence.json` が存在する
  - ステージの順序がカノニカルフローと一致する
  - 実行に完全なターミナル監査トレールがある
- 改善案：`config_hash` と `prompt_hash` を実行メタデータに追加して追跡するよ！

### 3. 自律性スコア (Autonomy Score)
- 定義：人間の介入なしにワークフローが完了した割合だよ！
- 減点対象：
  - 手動での再実行
  - 競合によるロックのスキップ
  - 人間による修復ステップ
  - 実行中のアドホックなシェルでの修正
- 推奨されるシグナルソース：
  - `logs/agent_activity.jsonl`
  - サービス/タイマーログ
  - 日次ログ内のフォールバックおよび自動修復マーカー

### 4. 多様性スコア (Diversity Score)
- 定義：既存の `creative_freshness.diversity_score` だよ！
- 現在の基準：
  - フックのパターン
  - ケイデンスのプロファイル
  - トピックのカテゴリ
- `runs/<bucket>/<date>/audit/creative_freshness_report.json` からレポートを取得するよ！

### 5. 動画クオリティスコア (Video Score)
- 定義：サムネイル、継続性、公開品質の複合スコアだよ！
- 現在の入力：
  - `src/io/utils/qa/iqa_check.ts` からのサムネイルIQAスコア
  - `src/domain/agents/audit.ts` からのサムネイル継続性スコア
  - `publish/receipt.json` からの公開証明
- 複合スコアの計算式（仮）：
  - `video_score = 0.45 * thumbnail_iqa + 0.35 * thumbnail_continuity + 0.20 * publish_proof`

## 📝 ログ設計 (Log Design)

- システム用に1つの追記型イベントログを保持し、実行ごとに1つの永続的なエビデンスバンドルを保持するよ！
- 必須イベントフィールド：
  - `timestamp`, `run_id`, `bucket`, `stage`, `event`, `status`, `score`, `config_hash`, `prompt_hash`, `model`, `retry_count`, `artifact_path`, `error_code`
- すべての実行は機械可読なターミナルレコードで終了する必要があるよっ！
- すべての失敗は、正確な失敗ステージと次のアクションを明記するよ！

## ⚙️ 改善ループ (Improvement Loop)

1. `task improve:report` を実行するよ！
2. 7日間と30日間のベースラインを記録するよっ！
3. 最も低いメトリクスを特定するよ！
4. 1つのことだけを変更するよ！
5. 同じ測定を再実行するよっ！
6. エビデンスや公開可能性を損なわずにメトリクスが改善された場合のみ変更を保持するよ！
7. 学んだレッスンを次のワークオーダーに追加してね💕

## ⏰ 自律設定 (Autonomy Settings)

- 固定された日次の制御パスとして `yt3-automation.timer` を保持するよ！
- 自律的なASMRパスとして `yt3-asmr-autonomous.timer` を保持するよっ！
- 高コスト処理の無限再起動を避けるため `yt3-automation.service` は `Restart=no` とし、07:00実行と08:00 sentinelのタイマーベース再エントリーだけを使うよ！

## 🌸 agy ワークオーダー (agy Work Order)

- このドキュメントを最初に読んでねっ！
- カノニカルなレポートタスクを使って現在の状態を測定してね！
- ループを改善するために、最小限のファイルセットを修正または拡張してね💕
- 新しいログや監査のアーティファクトを発明するより、既存のものを優先してね！
- 変更したファイルとメトリクスへの影響を報告してねっ！✨
