---
name: visual-design
description: サムネイルとUIの視覚仕様を統合管理するスキル。日本語組版、配色、レイアウト、可読性検証を扱う。
type: skill
---

# Visual Design

## 目的

サムネイル・UIの視認性とブランド整合を維持する。

## 必須パス

- ルート: `/home/kafka/2511youtuber/v3/yt3`
- 画像出力: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`
- フォント参照: `Noto Sans JP`

## フォーマッター/検証

- CSS/TS整形: `bun run format`
- ビルド検証: `bun run build`

## ワークフロー

1. 文字種が日本語を含む場合は `Noto Sans JP` を適用する。
2. 主要配色は `#103766` と `#288CFA` を基準に定義する。
3. タイトルと補助情報の階層を分離して配置する。
4. モバイル縮小表示で可読性を確認する。
5. 出力物を run ディレクトリへ保存する。
