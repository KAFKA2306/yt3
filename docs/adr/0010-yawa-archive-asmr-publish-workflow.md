# ADR-0010: 夜話アーカイブ ASMR 投稿ワークフロー

この文書は、夜話アーカイブの投稿実務に加えて、秒算マネーとのチャンネル分離ルールも含む親 ADR です。

## Status

Accepted

## Context

「夜話アーカイブ ASMR」は、高頻度かつ高品質な音声作品を投稿するブランドである。
既存の「秒算マネー」とは異なる視聴者層と、ASMR特有の検証（ASR等）が必要なため、専用の投稿ワークフローを定義する。

## Decision

以下のワークフローを標準化し、すべてのASMR作品に適用する。

1.  **分離プロファイルの使用**:
    - 必ず `ENV_FILE=config/.env.yawa` を使用する。
    - 投稿コマンドは `task publish:yawa` に集約する。

2.  **投稿前検証 (Pre-flight)**:
    - チャンネル名が「夜話アーカイブ ASMR」であることを自動照合する。
    - ASR (Whisper) によるスクリプト整合性チェックを必須とする。

3.  **投稿設定**:
    - `privacyStatus`: `private` (固定)。
    - `selfDeclaredMadeForKids`: `false` (固定)。
    - `YOUTUBE_ALLOW_PUBLICIZE`: 手動でのみ `true` に設定可能。

4.  **ディレクトリ構造**:
    - `runs/YYYY-MM-DD/publish_new_work/` に全成果物を集約し、このパスを `run_id` として扱う。

## Channel Isolation

投稿事故を防ぐため、チャンネルごとに profile を分離する。

- `config/.env.byosan` は `秒算マネー` 用
- `config/.env.yawa` は `夜話アーカイブ ASMR` 用
- `token.json` が存在しても、正しいチャンネルの保証にはならない
- 投稿前に `channels.list({ mine: true })` を実行し、期待する `channelId` と `snippet.title` を照合する
- 不一致なら投稿を中止する
- `publish` は `ENV_FILE` がない場合に失敗させ、暗黙の既定値に頼らない
- `publish:byosan` と `publish:yawa` を明示的な実行入口にする

## Consequences

- 誤って金融系チャンネルへASMRを投稿するリスクを物理的に排除できる。
- 投稿品質の自動担保（ASR検証）が可能になる。
- チャンネルごとのブランドイメージを個別に管理・育成しやすくなる。
