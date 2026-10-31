# HyperFrames １場面比較

2026-10-31、公開済み run `byosan_money/2026-10-31-daily-0400` の５番目の数字場面を、現行 Remotion 描画と HyperFrames 0.8.222 で比較した。制作・公開経路は変更していない。

## 方法

`media/video/remotion_public/props.json` の `scenes[4]` と、その frame、text、data、chip の SVG およびキャラクター画像を使用。両方とも 1920×1080、30 fps、１秒。Remotion は既存の `src/remotion/render.mjs`、CRF 14、既存のブラウザーを使用。HyperFrames は同じ４層を HTML に置き、付属 GSAP でフェードと上方移動を付け、標準品質・１ワーカーで描画した。アニメーションの曲線は同一ではない。

HyperFrames の [リリース v0.8.222](https://github.com/heygen-com/hyperframes/releases/tag/v0.8.222) と [描画手順](https://hyperframes.heygen.com/guides/rendering) を参照した。ローカルで実行し、テレメトリーを無効にした。生成物と入力は `artifacts/benchmarks/hyperframes-484/` に保存した。このディレクトリは Git の管理対象外。

## 結果

- Remotion: バンドルを含む実行時間 8.69 秒、出力 285,880 bytes。
- HyperFrames: 初回はブラウザーのダウンロードを含み 161.40 秒、ブラウザー準備済みの２回目は 4.68 秒、出力 269,073 bytes。エンコード品質と実行条件は異なるため、速度の厳密な優劣を示す測定ではない。
- ２回の HyperFrames 出力の SHA-256 はともに `dcbfe1c8c21a2ecc402ae2a63be63874653a3e243c0579aa6ffd7454199a9349`。この２回に限りバイト単位で一致した。
- 0.95 秒の静止画同士の SSIM は 0.996439。両方とも同じ SVG とキャラクター画像を使っており、別々のデザインの品質比較ではない。
- HyperFrames の一時インストールは `node_modules` 111 MiB。既存のプロジェクト依存には追加していない。

今回の試作は既存の表示層に入場動作を付けたもので、数字のカウントアップは実装していない。動きが理解や視聴体験を改善するかは未検証。描画方式の置き換えは判断しない。

比較中、元の場面では割合「82%」の表示に不要な `+` が付いていることを発見した。公開済み動画は変更できないため Issue #500 に記録し、以後のチャートで元の符号と小数桁を維持する修正を行った。
