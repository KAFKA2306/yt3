# 📁 002: YouTube チャンネル設定マニュアル

## 1. チャンネルプロファイルの切り替え

本プロジェクトはマルチチャンネル管理に対応しています。実行時に `ENV_FILE` を指定することで、投稿先を切り替えます。

| チャンネル名 | プロファイル名 | 環境ファイル | 実行コマンド例 |
| :--- | :--- | :--- | :--- |
| 秒算マネー | `byosan` | `config/.env.byosan` | `task publish:byosan -- <RUN_ID>` |
| 夜話アーカイブ ASMR | `yawa` | `config/.env.yawa` | `task publish:yawa -- <RUN_ID>` |
| 人類観測所 | `humanity` | `config/.env` | `task publish:humanity -- <RUN_ID>` |

`channelId` を最終ゲートにするため、タイトルや handle は補助情報として扱います。

## 2. 新規チャンネルの認証手順 (OAuth)

新しいチャンネルを追加、または認証を更新する場合は以下の手順で行います。

1.  `config/.env.<profile>.example` をコピーして `config/.env.<profile>` を作成。
2.  `task auth:<profile>` (例: `task auth:yawa`) を実行。
3.  表示されたURLをブラウザで開き、**対象のブランドアカウント**を選択して認可。
4.  リダイレクトURLから `code=` 以降をコピーしてターミナルに貼り付け。
5.  表示された `REFRESH_TOKEN` を `.env` ファイルに保存。
6.  `YOUTUBE_CHANNEL_PROFILE` は exact key のまま保存する。互換名や自然言語の省略は使わない。

## 3. 安全装置

- **Channel Matching**: `channelId` が最終ゲートです。`title` と `handle` は観測用で、これらだけでは publish しません。
- **Auto-Private**: すべての動画は `private` 設定でアップロードされます。
