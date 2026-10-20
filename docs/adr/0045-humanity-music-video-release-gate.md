# ADR 0045: 人類観測所の音楽動画の公開ゲート

## ステータス

Accepted

## 背景

- 人類観測所の `default_visibility` は `public` で、`assertProductReleaseGate` は非 private の公開に `assertFactualIntegrityGate` を要求する。
- そのゲートは `audit/result.json` に critical check が1つ以上あり、すべて PASS で、名前に `provenance` または `integrity` を含む PASS が1つ以上あることを求める。
- 音楽動画には事実主張がなく、既存の台本監査では PASS しない。ゲートを弱めたり迂回したりすることは禁止されている。
- 曲は YuE2-3B（重みは CC BY-NC 4.0 と個人クリエイター許可、`MODEL_LICENSE` 2026-09-16）で生成する。運営は個人の立場である。

## 決定

ゲートのコードは変更しない。音楽 run 専用の監査が、同じ形式の `audit/result.json` を生成する。

1. Run は `runs/humanity_observatory/music-<YYYY-MM-DD>` に置き、`state.json` の `bucket` は `humanity_observatory`、`video_path` は mp4 とする。
2. 音楽監査は次の critical check を決定論的に判定する。LLM の自己採点だけで PASS にしない。
   - `music_provenance`: `result.json` の model identity、重みの SHA-256、`request.json`、seed、`MODEL_LICENSE` の SHA-256 が揃っている。
   - `music_integrity`: `audio.flac` の SHA-256 が `ledger.jsonl` と一致し、`truncated` が両方 false、長さが config の下限以上、最後の1秒が config の閾値以下までフェードしている。
   - `visual_provenance`: 映像素材ごとに生成ツール、プロンプト、SHA-256、ライセンス根拠が記録されている。
   - `music_rights`: 歌詞が当該 run で新規に生成されたもので、第三者の歌詞と音源を含まないという個人運営者の宣言が、config の根拠ファイルに紐づく。
3. 準備は `task humanity:music-prepare DATE=YYYY-MM-DD` とする。生成、映像合成、監査、`release:check` までを行い、公開しない。成功時だけ `PUBLISH_READY_RUN` と `PUBLISH_COMMAND` を出力する。
4. 公開は `task publish PROFILE=humanity -- humanity_observatory/music-<date>` だけを使う。運営者は 2026-10-20 に、毎日の公開をエージェントのタスクとして委任した。許可の範囲は、ゲートが PASS した音楽 run の正規経路による公開に限る。ゲートが失敗した run は、公開せず報告する。
5. プレイリストは公開後の工程とする。`playlists.insert` と `playlistItems.insert` を使い、現行の OAuth スコープ（`youtube`）で足りる。プレイリストの存在は `playlistItems.list` の read-back で確認する。
6. YouTube の URL は省略せず、フルパスで記録する。
   - 動画: `https://www.youtube.com/watch?v=<video_id>`
   - プレイリスト: `https://www.youtube.com/playlist?list=<playlist_id>`
   - 記録先: `publish/receipt.json`、`ledger.jsonl`、`playlist.m3u8`
7. 映像素材の画像生成は `codex-imagegen "<prompt>" <out.png> --size WxH` で行う（codex-bridge ce89dd4 のラッパー、MIT）。内部で `codex exec -C <出力先> -s workspace-write` を明示するため、`~/.codex/config.toml` の既定（`danger-full-access`、`approval_policy = "never"`）の権限は使わない。生成物ごとにプロンプトと SHA-256 を `visual_provenance` へ記録する。
8. 人類観測所の既存の毎日投稿と同日に2本公開してよい（運営者の決定、2026-10-20）。

## 検証の層

| 層 | 証拠 | 状態 |
|---|---|---|
| リポジトリ | `task check:merge` と exact-head CI | UNVERIFIED |
| 製品 | `task release:check PROFILE=humanity -- <run-id>` の PASS | UNVERIFIED |
| 実行環境 | 12GB GPU で音楽 run が最後まで生成できること | 検証済み（2 曲、191.8 秒まで） |
| 公開 | 2026-10-20 に `3-l1o_GFg_o` が public になり、プレイリスト `PLVIqdnzwksiI` に read-back で含まれることを確認 | 検証済み |
| AI ラベル | `containsSyntheticMedia` は送信したが、API の read-back に現れない | UNVERIFIED |
| サムネイル | カスタムサムネイルの権限がなく設定をスキップ | 未達 |

## 未決事項

- 映像の方式（静止画ループ、歌詞テロップ、生成画像の枚数）。
- サムネイル権限（チャンネルの電話認証）。
- `containsSyntheticMedia` の反映確認。
- 常設の公開許可の文面と、その記録先。
- 公開の最初の1回を private で行うか。
