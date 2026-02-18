---
description: 日次本番パイプラインの実行・監視・再開の手順（自律実行版）
---

# /run — 運用ガイドライン (Autonomous Edition)

このワークフローは、Antigravity が「高品質な動画を毎日安定して配信する」ために、サービスの起動から配信確認までを自律的に完遂するための手順です。

// turbo-all

## 1. 制作・配信の全自動実行

以下のコマンドを順次実行し、パイプラインを完遂させます。

### ステップ 1：環境の準備
依存サービス（Voicevox, Discord Bot 等）を起動します。
```bash
npx tsx scripts/tasks.ts up
```

### ステップ 2：パイプラインの実行
メインエンジンを起動します。`RUN_ID` が指定されない場合は自動生成されます。
```bash
npx tsx scripts/tasks.ts run
```

### ステップ 3：実行結果の検証
ログファイルをチェックし、正常終了していることを確認します。
```bash
grep "SUCCESS" logs/agent_activity.jsonl | tail -n 1
```

### ステップ 4：後片付け
すべての検証が完了したら、バックグラウンドプロセスを停止します。
```bash
npx tsx scripts/tasks.ts down
```

---

## 2. 異常時の自律リカバリ

処理が失敗した場合は、以下の手順でレジュームを試行します。

### ステップ 1：失敗箇所の特定
エラー内容と最後に完了したフェーズを確認します。
```bash
tail -n 20 logs/agent_activity.jsonl
```

### ステップ 2：不完全な中間ファイルの削除
`MEDIA` フェーズで失敗している場合は、キャッシュをクリアします。
```bash
# RUN_ID はログから特定
rm -rf runs/${RUN_ID}/media
```

### ステップ 3：レジューム実行
環境変数 `RUN_ID` を指定して再実行することで、完了済みのフェーズをスキップして再開します。
```bash
RUN_ID=${RUN_ID} npx tsx src/index.ts
```

---

## 3. 運用ポリシー：モデル固定

> [!IMPORTANT]
> **Gemini 3 Flash の厳守**
> 本システムは `gemini-3.0-flash-preview` を前提としています。自律実行中もモデルの変更は行わず、API レート制限（429）が発生した場合は、指数関数的バックオフによる待機、またはその日の実行中止を選択してください。