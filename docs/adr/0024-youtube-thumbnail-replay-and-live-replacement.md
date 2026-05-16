# ADR-0024: YouTube 公開動画サムネイル再現・差し替え運用

## ステータス
Accepted

## コンテキスト
秒算マネーでは、公開済み動画の metadata を起点にサムネイルを再現し、CTR を改善したいケースがある。
過去の `runs/` が残っていない場合でも、YouTube 側の live metadata は残るため、そこを single source of truth にすれば再現が可能である。

従来は、再現手順・画像生成・サイズ正規化・QA・差し替えが分散しており、毎回のトークン消費と手戻りが大きかった。

## 意思決定
公開動画のサムネイル更新は、以下の最小固定手順で実行する。

1. `youtube.videos.list` で live metadata を取得する。
2. タイトル・説明文・タグから、再現用の短い image prompt を作る。
3. `imagegen` で 1-3 案を生成する。
4. 採用案を `runs/YYYY-MM-DD/<project_id>/thumbnail.png` に保存する。
5. 必要なら `1280x720` に正規化する。
6. `iqa_check.ts` で可読性と解像度を確認する。
7. `youtube.thumbnails.set` で既存の公開動画に差し替える。
8. `youtube.videos.list` で対象 videoId と metadata の整合を再確認する。

## 運用規約

- 元の動画タイトルと説明文は、依頼がない限り変更しない。
- 再現は `thumbnail-replay` skill を使う。
- prompt は短く保ち、mobile readability を最優先にする。
- QA に落ちた画像は、差し替え前に必ず修正する。
- 公開動画の更新前に、対象 channel の identity を確認する。

## 影響

- メタデータだけ残っている公開動画でも、後から同じ手順で再現できる。
- サムネ更新の判断と実装が一つの手順にまとまり、再現性が上がる。
- 低品質な差し替えを QA で止めやすくなる。
