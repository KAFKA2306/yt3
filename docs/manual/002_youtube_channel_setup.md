# 📁 002: YouTube チャンネル設定マニュアル

## 1. チャンネルプロファイルの切り替え

本プロジェクトはマルチチャンネル管理に対応しています。実行時に `ENV_FILE` を指定することで、投稿先を切り替えます。

| チャンネル名 | プロファイル名 | 環境ファイル | 実行コマンド例 |
| :--- | :--- | :--- | :--- |
| 秒算マネー | `byosan_money` | `config/.env.byosan` | `task publish:byosan -- <RUN_ID>` |
| 夜話アーカイブ ASMR | `yawa_archive_asmr` | `config/.env.yawa` | `task publish:yawa -- <RUN_ID>` |

## 2. 新規チャンネルの認証手順 (OAuth)

新しいチャンネルを追加、または認証を更新する場合は以下の手順で行います。

1.  `config/.env.<profile>.example` をコピーして `config/.env.<profile>` を作成。
2.  `task auth:<profile>` (例: `task auth:yawa`) を実行。
3.  表示されたURLをブラウザで開き、**対象のブランドアカウント**を選択して認可。
4.  リダイレクトURLから `code=` 以降をコピーしてターミナルに貼り付け。
5.  表示された `REFRESH_TOKEN` を `.env` ファイルに保存。

## 3. 安全装置

- **Channel Matching**: プロファイルに記述された `YOUTUBE_EXPECTED_CHANNEL_TITLE` と実際のチャンネル名が一致しない場合、アップロードは即座に中止されます。
- **Auto-Private**: すべての動画は `private` 設定でアップロードされます。
