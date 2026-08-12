# ADR-0042: 破壊的なコマンドから大切な成果物をまもる！「安全ハーネス（Preflight Destructive Command Harness）」の導入だよぉ！🎀✨

## Status (じょうたいっ☆)

Accepted (みんなでオッケーしたよぉ！🐾)

## Context (背景だよっ！🥺)

AIエージェントさんが作業しているときに、うっかり `git clean -fd` とか `git restore` みたいな破壊的なコマンドを直接打っちゃうと、まだ Git に登録していない大切な画像（PNG/WebP/JPG）や、大事なデータ（`db/prompts.json` など）がぜーんぶ消えちゃう危険があったのぉ…！💦
「気をつける」だけじゃどうしてもミスしちゃうから、AIエージェントさんが危険なコマンドを叩く前に、機械的にぜーったいにブロックできる【安全ハーネス（実行前チェック機構）】が必要になったんだよっ！💖

## Decision (きめたことっ！🌸)

とっても安全なハーネススクリプトを新しく作ったよっ！これからは、成果物をこわしちゃう可能性のある操作をする前に、かならずこの安全ハーネスを通さなきゃダメだよぉ☆

### 1. ぜったいルール（鉄の掟だよっ！）
- `git clean -fd` を直接実行するのはぜーーったいに禁止だよ！🙅‍♀️
- かわりに `scripts/safe_git_clean.sh` を使ってね♪
- 破壊的な操作（`git clean`, `git restore`, `git reset`, `rm`, `mv`, `checkout` など）をする前には、かならず `scripts/guard_destructive.sh` を走らせて、安全かどうか機械チェックするよ☆
- 「安全だよ！」っていう自己申告（LLMの言い訳）は禁止！スクリプトの終了コード（PASS/FAIL）だけで判定するよ！

### 2. ハーネスの検査ルール（なにをチェックするの？🧐）
- **未追跡ファイルのリストアップ**: まだコミットされていない新しいファイルをぜんぶ調べるよ！
- **変更されたファイルの検出**: どのファイルが書き換えられたかチェックするよ！
- **未追跡画像のブロック**: `artifacts/`, `dist/artifacts/`, `generated/`, `tmp/` の下に未追跡の画像ファイル（`.png`, `.webp`, `.jpg`, `.jpeg`）があったら、実行を即座にストップ（FAIL）するよ！
- **プロンプトDBの保護**: `db/prompts.json` が変更されていたら、絶対にストップするよ！
- **未登録成果物の保護**: `artifacts/` の中に `db/evolution.db` に登録されていないファイル（`.gitkeep` 以外）があったら停止するよ！
- **エビデンスの保存**: チェックが走るたびに、`runs/destructive_guard/YYYYMMDD-HHMMSS/` という専用のディレクトリを作って、そこに `git_status.txt` や `backup_manifest.json` などの証拠ファイルをしっかり残すよ！

### 3. スクリプトの構成（なかみだよぉ✨）
- [guard_destructive.sh](file:///home/kafka/2511youtuber/v3/yt3/scripts/guard_destructive.sh) : 安全確認のコアエンジンだよ！
- [safe_git_clean.sh](file:///home/kafka/2511youtuber/v3/yt3/scripts/safe_git_clean.sh) : `git clean` の安全なラッパーだよ！

## Consequences (どうなったの？お楽しみだよぉ☆ 🐾)

- **うっかり消えちゃう悲劇がゼロに！**: 危険な状態のときはスクリプトが exit code `1` でビシッと落ちてくれるから、大切なデータが消えちゃう心配がなくなったよぉ！ヤッター！🎉✨
- **証拠がばっちり残るよ！**: 毎回 `backup_manifest.json` が作られるから、何かあってもすぐに状態を復元できるよっ！
- **エージェントさんも安心！**: 難しい判断をしなくても、機械チェックの `PASS` を確認するだけで自信を持って作業を進められるねっ♪
