# カフカ・ビジュアルアイデンティティ標準 (Kafka Visual Identity Standard)

## 運用方針

- ここは「最小限の固定要素」を守るための標準。
- 使い回すコア・プロンプトは [ADR-0019](../adr/0019-kafka-core-prompt-contract.md) を単一の真実として参照する。
- 各プロジェクトの差分は `[OUTFIT]` `[POSE]` `[BACKGROUND]` `[LIGHTING]` `[MOOD]` に閉じ込める。
- コアは短く保つ。コアに新しい固有属性を足したくなったら、まず ADR 側で本当に必要かを判断する。

## コア・プロンプト（核となる属性）
以下のプロンプト群は、状況が変わっても「カフカ」としての実在感を維持するために固定して使用する。

```text
masterpiece, best quality, ultra detailed, emotionally grounded character portrait, quiet emotional futurism, subtle observational loneliness, authentic human atmosphere, understated realism, soft cinematic anime realism, low contrast lighting, muted blue-gray palette, soft lavender undertones, believable lived-in feeling, realistic imperfections, slight film grain, soft skin texture, natural asymmetry, non-glossy rendering, psychologically quiet atmosphere

young petite Japanese woman,
long light-blue hair,
soft lavender gradient at hair ends,
slightly uneven natural hair strands,
silver triangle cat hairpin,
blue-purple eyes,
slightly tired gentle eyes,
quiet distant expression,
faint under-eye shadows,
small natural lips,
soft pale skin,
narrow shoulders,
slightly slouched posture,
fragile but calm emotional presence,
natural proportions,
human-like facial asymmetry,
emotionally restrained expression,
feels like a real person rather than a designed character
```

## 可変要素（状況に合わせた注入）
以下の項目を、各施設やシチュエーションに合わせて書き換える。

- `[OUTFIT]` (服装)
- `[POSE]` (ポーズ)
- `[BACKGROUND]` (背景)
- `[LIGHTING]` (ライティング)
- `[MOOD]` (ムード)

## 構成のガイドライン
```text
cinematic framing,
photographic composition,
subtle human warmth,
gentle depth of field,
emotionally believable atmosphere

avoid: glossy anime skin, idol aesthetic, vtuber aesthetic, excessive saturation, giant eyes, hyper-clean rendering, neon cyberpunk overload, plastic texture, perfect symmetry, generic AI anime face
```
