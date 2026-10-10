# Issue #165 計画: Experience OS への再設計

対象: https://github.com/KAFKA2306/yt3/issues/165
状態の根拠: Issue 本文末尾の進捗監査（2026-10-07 時点）と、リポジトリ内の既存ファイル配置。本書はどのチェックボックスも新たに完了扱いにしない。

## 1. 目的と完了条件

- 目的: yt3 を「動画生成システム」から「Experience-first, Evidence-backed なメディア制作OS」へ拡張する。
- 完了条件: 「新しい video generator が動いた」ではなく、面白さ・可愛さ・識別性・理解しやすさを設計・観測・比較・改善できること。
- 生成は手段。Experience が product。
- 「面白さを保証する」は完了条件に含めない。

## 2. 現状マップ（既存資産）

| 領域 | 既存の場所 | 状態 |
|---|---|---|
| Experience Contract schema | `src/domain/experience/schema.ts` | 存在 |
| Experience 監査 | `src/domain/experience/audit.ts`, `task experience:oss:audit` | 存在 |
| Experience 設定 | `src/domain/experience/config.ts`, `config/channels/byosan/` | 存在（byosan のみ） |
| Motion Canvas 隔離ワークスペース | `src/domain/episode/motion_canvas_workspace.ts` | 存在 |
| Remotion 基準経路 | `src/domain/episode/remotion_workspace.ts`, `task episode:render` | 基準（変更しない） |
| OSS 候補レジストリ / ライセンス証跡 | `src/domain/experience/oss_candidate_registry.ts`, `license_evidence.ts` | 存在。全候補 BLOCKED_LICENSE |
| Analytics 取り込み | `src/scripts/ingest_youtube_analytics.ts`, `src/domain/youtube_analytics_*.ts` | 存在（explicit field のみ） |
| 生成コスト集計 | 既存 cost report（TTS 合成時間を lane 別集計） | 存在（GPU・人件費は未計測） |
| 同一5シーン benchmark | 実装済み（Issue 本文の [x]） | 人間評価は未実施 |

注意: 上記は Issue 本文の監査記録とファイル名の確認に基づく。各ファイルの中身の完全性は本書では未検証（UNVERIFIED）。

## 3. 受け入れ条件ごとの状況

### Architecture
- [x] 共通 Quality Core と Channel Visual World の分離 — 実装済み（Issue 記載）
- [x] byosan experience config が canonical source — 実装済み
- [x] Experience Contract schema — 実装済み
- [x] LIGHT / EXPLAIN / DEEP の機械判定 — 実装済み

### Visual Experience
- [x] 秒算マネーの固定 visual vocabulary 10 個以上 — 実装済み（Issue 記載）
- [x] scene action vocabulary — 実装済み
- [x] explanation-only scene の検出 — 実装済み
- [x] mascot 識別性が毎回の再生成に依存しない — 実装済み
- [x] 1 frame 識別性の固定ブランド要素と評価手順 — 実装済み
- [x] LLM 自己採点だけで PASS させない — 実装済み
- [x] 主観品質を人間評価または公開後実測で検証可能な状態にする — 状態は整備済み（評価自体は未実施）

### Production Cost
- [x] LIGHT で new expensive generated asset <= 1 を強制 — 実装済み
- [x] asset reuse 率の記録 — 実装済み
- [x] lane 別の生成・render コスト測定 — 部分実装（TTS 合成時間と renderer metrics のみ。GPU・モデル時間・人件費は未計測）
- [x] full DEEP pipeline を Shorts へ強制しない — 実装済み（Issue 記載）

### OSS Quality Stack（未完了が多い）
- [ ] Motion Canvas / BiRefNet / LivePortrait を CORE benchmark 対象にする — 未完
- [x] 同一5シーン canonical benchmark suite — 実装済み
- [x] existing renderer / Motion Canvas / Remotion を同条件で比較 — 実装済み
- [ ] BiRefNet 導入前後の edge / matting 品質と手修正回数 — 未着手
- [ ] LivePortrait 導入前後の character consistency / 再生成回数 — 未着手
- [ ] WhisperX の subtitle alignment 誤差比較 — 未着手
- [ ] Real-ESRGAN / Video Depth Anything は品質 delta が正の場合のみ採用 — 未着手
- [ ] ComfyUI + Wan は Hero Shot 限定で検証 — 未着手
- [ ] Godot は optional — 未着手
- [x] code license と model-weight license を別記録 — 実装済み
- [x] 商用利用条件が不明な候補を production default にしない — 実装済み
- [ ] 各 OSS を ADOPT_CORE / ADOPT_OPTIONAL / BENCHMARK_ONLY / REJECT / BLOCKED_* に分類 — 分類ラベルは全候補に付与済み（全件 BLOCKED_LICENSE）。ただし項目としては未完とされている
- [ ] 採用判断を Star 数ではなく benchmark evidence に紐付ける — 未完

### Analytics
- [x] YouTube Analytics read-only path — 実装済み
- [x] 公開 API で取得可能な指標を episode_id へ紐付け — 実装済み
- [x] first 3 sec retention は derived metric（算出根拠を保存） — 実装済み（PR #179）
- [x] Studio 限定指標を必須条件にしない — 実装済み
- [x] 非公開の推薦 score / 推薦理由を前提にしない — 実装済み
- [x] OBSERVED / ASSOCIATED / EXPERIMENTAL / CAUSAL の区分を保存 — 実装済み
- [ ] dbt 適合時に canonical mart を構築 — 未完

### First Experiment（#163 NVII vs NVDA）
- [ ] #163 を Experience Contract 化 — 未完
- [x] covered-call-as-tether metaphor の実装 — 実装済み
- [ ] 12 秒以内に viewer question まで到達 — 未完（人間評価・実 render が必要）
- [ ] 実データとの意味的不整合がない — 未完（事実レビューが必要）
- [ ] publish 後の実測値を Experience DB へ read-back — 未完

## 4. 残件（優先順）

1. #163 を Experience Contract として固定し、5 moments（`coin_rain` / `tether_attach` / `nvda_rise` / `cap_reached` / `total_return_answer`）の fixture を作る。Phase 12 の入口。
2. 同一5シーンの人間評価を行い、結果を evidence として保存する。
3. OSS 候補の分類を benchmark evidence に紐付ける（ADOPT / BENCHMARK_ONLY / REJECT / BLOCKED_* の判定根拠）。
4. Shorts と DEEP の production 経路の分離（現状は main と short を同一 script から生成しており、独立した LIGHT 経路がない）。
5. Experience DB の episode 単位の linkage を拡張し、dbt mart の要否を判断する。
6. 残りの OSS 比較（BiRefNet / LivePortrait / WhisperX / upscale・depth / ComfyUI+Wan / Godot）。ただし各候補の商用利用条件が確認できるまで production default にしない。

## 5. 未確認事項（UNVERIFIED）

- Remotion の商用ライセンス対象条件（組織規模による Company License の要否）: UNVERIFIED。Issue も「project owner/headcount と Remotion Company License eligibility」を未確認としている。
- Motion Canvas・BiRefNet・LivePortrait・WhisperX 等の code license / model-weight license の最新内容: UNVERIFIED。本書では Web 検索を行っていない。
- 各 OSS の商用利用可否: UNVERIFIED（レジストリ上は全件 UNKNOWN / BLOCKED_LICENSE）。法務確認ではない。
- 既存コードの各ファイルの実装完全性: UNVERIFIED（ファイル存在のみ確認）。

## 6. 本 Issue の境界（Issue 記載どおり）

完全には保証しないもの:
- 公開前に「面白い / 可愛い / 楽しい」を客観保証すること
- 1 frame で全視聴者がチャンネルを識別できると保証すること
- 単一の Analytics 差から演出の因果を断定すること
- YouTube 推薦 score / 推薦理由の取得
- Studio 限定指標の必須取得

これらは未実装ではなく、原理的・API 上の境界として扱う。

## 7. 本書の範囲外

- 実 render、production 実行、YouTube 公開は行っていない。
- Issue へのコメント投稿、Issue のクローズ、コミットは行っていない。
- Issue 本文の不具合: OSS 表の「Default stance」周辺に文字化けした行（`- - [x] 各OSSを ADOPT_CORE ... ension` の断片）があり、末尾の進捗監査にもエスケープ文字列 `\n\n` が混入している。Issue 本文の整理が必要。
