---
type: "policy"
title: "YT3 Channel Benchmark Standard"
description: "3チャンネル（byosan・yawa・humanity）の3層評価（機械照合・独立ブラインド採点・dbt実績）と合格条件・反例・コマンドの正本。"
tags:
  - yt3/standard
  - yt3/benchmark
  - yt3/quality
aliases:
  - "チャンネル評価基準"
  - "YT3ベンチマーク"
  - "benchmark-standard"
generated:
  by: "antigravity/gemini-4-neon-high"
  at: "2026-11-20T00:45:00Z"
---

# YT3 Channel Benchmark Standard

3チャンネル（`byosan` / `yawa` / `humanity`）の品質と YouTube 成長・収益化（YPP）への寄与を、制作プロンプトやモデルの変更前後で再現可能に比較するための評価正本。

- **リリースゲートではない**: オーナー方針（2026-11-08）に従い、評価結果は診断および変更の採否判定に使い、日次公開コマンドの終了コードや公開権限を止めない（明示的な `--strict` 指定時のみ非 0 終了）。
- **単一スコア禁止**: 技術欠陥・編集意図・複数本の多様性・視聴者実績を 1 つの総合点に平均しない。

## 1. 3 層評価アーキテクチャ

| 層 | 種別 | ツール・正本 | 目的 |
| --- | --- | --- | --- |
| **Layer 1** | 決定論的グラダー（Code-based） | `task bench:byosan` / `task bench:yawa` / `task bench:humanity` / `task bench:all`、`task lexicon:report` | 技術欠陥・公開整合・禁止語・反復収束を毎回自動検出する（Regression eval）。 |
| **Layer 2** | 独立ブラインドモデル採点（Model-based） | `task bench:judge`（既定 `gemini-4-argon-high`、`--model=` で切替可）、[evaluate_byosan.ts](../../src/scripts/evaluate_byosan.ts)、`task yawa:diversity-audit` | 制作モデル（`gemini-4-neon-high`）とは別モデルで、由来と自己採点を伏せた二値／比較ルーブリック評価を行う（Capability eval）。 |
| **Layer 3** | 市場実績 + 人手校正（Outcome + Human） | `task analytics:refresh` → `task analytics:build`（[Star Schema & dbt Standard](star-schema-standard.md)）＋実視聴／聴取ログ | CTR・視聴維持率・再生リスト連続視聴率・登録純増・緑アイコン維持を観測し、Layer 2 の判定ズレを校正する。 |

### 参照した一次資料（2026-11-20 確認）

- **Anthropic — Demystifying evals for AI agents**: Code / Model / Human の 3 種グラダー分離、Capability vs Regression eval、`pass@k` / `pass^k`、二値ルーブリック＋根拠先出し、人手校正セットとモデル更新時の再校正（`https://www.anthropic.com/research/demystifying-evals-for-ai-agents`）。
- **YouTube 公式 — Inauthentic Content（旧 Repetitious Content）ポリシー**: 量産・定型反復の排除と、シリーズ作品における回ごとの固有コンセプト要求（`https://support.google.com/youtube/answer/1311392`）。
- **YouTube 公式 — 広告掲載に適したコンテンツのガイドライン / 合成メディア開示**: 性的興奮目的の音声・描写の制限と、リアルな合成音声・映像の開示義務（`https://support.google.com/youtube/answer/6162278`, `https://support.google.com/youtube/answer/14328491`）。

## 2. チャンネル別 必須項目・反例・合格条件

### 2.1 `byosan`（秒算マネー）

- **入口・コマンド**: `task bench:byosan`（任意で `-- --limit=5 --with-lexicon` / `-- --run=<name>`）
- **参照方針**: [秒算マネー Mission](../byosan/MISSION.md)

| ID | 層 | 重大度 | 合格条件 | 既知の失敗例（反例） |
| --- | --- | --- | --- | --- |
| `pipeline_completed` | L1 | critical | `audit/failure_trace.json` が無く `source/feature_spec.json` が生成済み | `E2BIG: argument list too long` で生成前に停止 |
| `existing_audits_pass` | L1 | critical | `audit/result.json` 全項目と `audit/authenticity.json` が `PASS` | 未検証 `claim_id` や第三者URL混入 |
| `no_investment_advice` | L1 | critical | タイトル・概要欄・台本に投資推奨／断定語が 0 件 | 「今すぐ買え」「暴落確定」「確実に儲かる」 |
| `no_ungrounded_draft_figures` | L1 | warning | `audit/feature_draft_issues.json` の未裏付け数値が 0 件 | 一次資料に無い家計換算・比率の混入 |
| `thumbnail_present` | L1 | warning | `thumbnail_youtube.jpg` または `thumbnail.png` が 1KB 以上 | サムネイル生成スキップ／0 バイト出力 |
| `publish_integrity` | L1 | critical（公開時） | `publish/state.json` が `VERIFIED` かつ `public` | アップロード途中で `UPLOADED` 停止 |
| L2 ルーブリック | L2 | 比較 | `structural_clarity` / `source_discipline` / `title_and_hook_fit` のブラインド比較 | ニュース表面の要約だけで構造説明がない |
| L3 実績 | L3 | 観測 | `mart_channel_growth_kpi` の `impression_weighted_ctr`, `avg_view_percentage_first_7d`, `net_subscribers_first_7d` | 再生は回っても冒頭離脱や登録増ゼロ |

### 2.2 `yawa`（夜話アーカイブ ASMR）

- **入口・コマンド**: `task bench:yawa`（任意で `-- --limit=5 --with-lexicon`）
- **参照方針**: [夜話アーカイブ ASMR Mission](../yawa/MISSION.md), [声の嗜好と演技基準](../yawa/voice-preferences.md), [固定キャスト正本](../yawa/characters.json)

| ID | 層 | 重大度 | 合格条件 | 既知の失敗例（反例） |
| --- | --- | --- | --- | --- |
| `core_media_and_publish` | L1 | critical | `validateYawaRun` が `PASS`（音声・動画・尺一致・SHA256・公開 read-back） | `video.mp4` 欠落や公開ハッシュ不一致 |
| `fixed_cast_member` | L1 | critical | `docs/yawa/characters.json` の 3 名（`haruka`/`shizuku`/`nao`）いずれかに一致 | 毎回使い捨ての一回限りキャラ（例: 旧ランの水野しおり） |
| `ad_friendly_metadata` | L1 | critical | 性的連想語・18+スラング・EDSA偽装文が 0 件 | 「R18」「耳舐め」「添い寝」「心理学研究のため」 |
| `no_prohibited_breath_cues` | L1 | critical | 台本・演技指示に禁止息音表現が 0 件 | 「耳元で息を吹きかけ」「長い吐息」「擦れた息」 |
| `thumbnail_present` | L1 | critical | `thumbnail.jpg` または `cover.png` が 1KB 以上 | `image_generation.json` スキップによるサムネ欠落 |
| `cast_rotation` / `no_late_night_care_convergence` | L1（横断） | warning | 直近 3 本が同一キャスト固定・全て「終電/寝かしつけ」へ収束していない | 3 回連続で同一キャラ・深夜寝かしつけ反復 |
| L2 ルーブリック | L2 | 比較 | `character_voice_and_presence` / `fresh_scenario_not_repetitive` / `all_ages_ad_safety` + `task yawa:diversity-audit` | キャラ口調が曖昧で推し感が出ない |
| L3 実績 + 聴取 | L3 | 観測 | `mart_channel_growth_kpi` の CTR・視聴維持率・登録純増＋緑アイコン維持＋週 1〜2 本の人手聴取 | 機械は PASS でも声色ドリフトや息の違和感がある |

### 2.3 `humanity`（雨晴はうの人類観測所）

- **入口・コマンド**: `task bench:humanity`（任意で `-- --limit=5 --with-lexicon`）
- **参照方針**: [雨晴はうの人類観測所 Mission](../humanity/MISSION.md), [作詞と制作指針](../humanity/songwriting.md)

| ID | 層 | 重大度 | 合格条件 | 既知の失敗例（反例） |
| --- | --- | --- | --- | --- |
| `music_audits_pass` | L1 | critical | `music_integrity` / `music_provenance` / `visual_provenance` / `music_rights` すべて `PASS` | 48kHz 崩れ、音声途切れ、映像尺ズレ |
| `synthetic_media_disclosed` | L1 | critical | `state.json` の `contains_synthetic_media === true` | 合成メディア開示フラグ欠落 |
| `short_memorable_title` | L1 | critical | 接尾辞（`\| 人類観測所の音楽`）を除いた曲名が 3〜15 文字 | 39 文字のラノベあらすじ風タイトル（旧ラン実例） |
| `jacket_thumbnail_present` | L1 | critical | 曲固有ジャケット `thumbnail.jpg` が 1KB 以上で存在 | サムネ未生成または 0 バイト |
| `description_context_present` | L1 | warning | 概要欄 40 文字以上 | 概要欄が空・短すぎる |
| `publish_integrity` | L1 | critical（公開時） | `publish/state.json` が `VERIFIED` かつ `public` | 非公開・未確認のまま放置 |
| `lexicon_diversity` | L1（横断） | warning | 歌詞の `pairwise Jaccard max <= 0.55` | 過去曲と酷似した定型歌詞の量産 |
| L2 ルーブリック | L2 | 比較 | `standalone_emotional_hook` / `memorable_short_title_fit` / `standalone_concept_and_mood` | 汎用BGM歌詞・あらすじ曲名（メロディ品質は聴取担当として未確認明記） |
| L3 実績 | L3 | 観測 | `mart_channel_growth_kpi` の CTR・完聴率・高評価率・`playlist_views_share_first_7d`・登録純増＋聴取 rating | 1 曲切りで再生リスト連続視聴につながらない |

## 3. 実行コマンド一覧

```bash
# Layer 1: 全3チャンネル（直近5件 + 語彙多様性）
task bench:all -- --limit=5 --with-lexicon

# Layer 1: チャンネル個別 / 特定ラン指定 / CI向け厳格終了コード
task bench:byosan -- --run=2026-11-19-daily-1200 --json
task bench:yawa -- --limit=5
task bench:humanity -- --limit=5 --strict

# Layer 2: 制作モデル（gemini-4-neon-high）から独立したブラインド採点（既定: gemini-4-argon-high）
task bench:judge -- single humanity music-2026-11-20-0630
task bench:judge -- compare yawa yawa-2026-11-20 yawa-2026-11-21

# Layer 3: dbt 分析マートの更新とデータ品質テスト
task analytics:refresh && task analytics:build
```

## 4. 現在の未確認・制約事項

- **Layer 3 実数値**: GCP プロジェクト `659942893881` で YouTube Analytics API が未有効化のため、実データは `UNVERIFIED`（有効化後に `task analytics:refresh && task analytics:build` で開通）。
- **Layer 2 人手校正**: `task bench:judge` は独立モデルによるブラインド採点と根拠先出しを実装済みだが、人手ラベル付き 30〜50 件の校正セットによる一致率測定前は出力に `calibration_status: "UNCALIBRATED"` を明記する。
- **知覚品質（音声・歌唱・映像美）**: テキスト LLM による Layer 2 採点では音声・歌唱・映像の実視聴は評価対象外とし、`perceptual_media_status: "UNVERIFIED"` として人手聴取・視聴と分離する。
