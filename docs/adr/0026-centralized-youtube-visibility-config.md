# ADR-0026: YouTube 公開設定の単一ソース化 (Single Source of Truth) ✨

## ステータス (Status)
Accepted 💕

## コンテクスト (Context)
これまで YouTube の動画公開設定（privacyStatus）が、`.env` ファイル、TypeScript コード内、そして `config/default.yaml` の 3 箇所に分散して定義されていたんだよぉ...。
これだと「設定を変えたはずなのに反映されない！」「どこが本当の正解なの？」っていう混乱（設定のデブ化 🐷）を招いちゃうし、YouTube のコンプライアンス運用（ADR-0023）を守る上でも危なっかしいよね。
「1つの事実は1つの場所に」という Zero-Fat 原則に従って、公開設定を一箇所にまとめることにしたのっ！

## 意思決定 (Decision) 🎀
公開設定のガバナンスを強化するために、以下の変更を行ったよっ！

1. **`config/default.yaml` を唯一の正解に (SSOT)**:
   - `youtube.default_visibility` を唯一の決定権を持つ場所としたよ。
   - `.env` や TypeScript 内のハードコードは一切禁止！✨

2. **`.env` ファイルからの設定排除**:
   - `config/.env.byosan` や `config/.env.yawa` にあった `YOUTUBE_DEFAULT_VISIBILITY` を全部削除したよ。
   - 環境変数は「秘密情報（APIキー等）」と「チャンネル固有の ID」だけに絞り込んで、設定の重複を許さないようにしたのっ！

3. **PublishAgent の厳格化**:
   - 実行時に必ず `default_visibility` が設定されているかチェックして、もし無かったら「FAIL Explicitly（はっきり失敗）」するようにしたよ。
   - 「とりあえず public」みたいな曖昧なフォールバックは廃止したのっ！
   - 起動時に `[PUBLISH:CONFIG] visibility=public source=config/default.yaml` というログを出して、どの設定が使われているか一目で分かるようにしたよ ✨

4. **決定論的な検証スクリプトの導入**:
   - `scripts/verify_visibility_config.sh` を作成して、ソースコードの中にハードコードが残っていないか、`.env` に設定が漏れ出していないかを `grep` で機械的にチェックできるようにしたよっ！

## 影響 (Consequences) 🌟
- **メリット**: 設定の場所が明確になったから、公開ミスを防げるしメンテナンスも楽ちん！「設定の脂肪」が削ぎ落とされて、システムがスリムになったよっ💕
- **デメリット**: 設定を `default.yaml` に書き忘れるとエラーで止まっちゃうけど、それは安全のためだから大歓迎だよねっ ✨
- **運用の変化**: 公開設定を変えたい時は、迷わず `config/default.yaml` を編集すれば OK だよ！
