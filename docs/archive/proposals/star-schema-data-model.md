# データモデル案: スタースキーマとオントロジーによる制作・準備・投稿の表現

## ステータス

Proposed（採用前の設計案。実装・移行は未着手）

## 目的

整理（取り込みと正規化）、準備（台本・音声・映像・監査）、投稿（公開・予約・計測）の全工程を、同じ論理モデルで表現する。
工程ごとに別々のログやファイルで状態を持つ現状を改め、状態・根拠・処理結果を追跡可能な一つの正本に寄せる。

## 現状（VERIFIED）

- `db/schema.sql` は `runs` を起点とする実行ログ中心の設計で、事実テーブルと次元テーブルを分けていない。
- 公開状態は `src/domain/publication_state.ts`、分析値は `youtube_analytics` テーブルにある。
- オントロジー関連は用語集の governance のみ（`docs/standard/ontology-standard.md`）。工程や投稿を表すオブジェクト定義はない。

## 三層構造

### 1. Raw 層（追記のみ）

- 一次資料、API 応答、生成物をそのまま保存する。既存の `raw_artifacts` を使い、ハッシュと取得時刻を必ず持つ。
- 更新・削除はしない。誤りは後続の変換で補正する。

### 2. Transform 層（再現可能な変換）

- Raw から正規化データを作る変換を、版管理された SQL または TypeScript で定義する。
- 各変換は入力ハッシュ、変換版、出力ハッシュを `runs` に記録する。同じ入力からは同じ出力になることを確認可能にする。

### 3. Star 層（分析・監査用）

事実テーブルは粒度（grain）を一つに決める。

| 事実テーブル | 粒度 | 主な測定値 | 主な外部キー |
|---|---|---|---|
| `fact_production_run` | 1 run | 尺、セグメント数、再試行回数、失敗コード | dim_date, dim_profile, dim_topic |
| `fact_audit_check` | run × 監査項目 | PASS/FAIL、観測値 | dim_profile, dim_check_rule |
| `fact_publication` | 1 公開試行 | visibility、publish_at、read-back 結果 | dim_date, dim_profile, dim_channel |
| `fact_analytics_daily` | 動画 × 日 × 指標 | 再生、保持、CTR（API 実測値のみ） | dim_date, dim_profile |

次元テーブル:

- `dim_date`、`dim_profile`（byosan / yawa / humanity）、`dim_channel`、`dim_topic`、`dim_source`、`dim_check_rule`、`dim_asset`

ルール:

- 分析値は API 実測値のみを格納する。推定値を混ぜない。
- `youtube_analytics` の 30 日保持境界（`analytics:refresh` の仕様）を、`fact_analytics_daily` でも守る。

## オントロジー層（オブジェクトと関係）

Star 層の上に、業務の意味を表すオブジェクト層を置く。

| オブジェクト型 | 例 |
|---|---|
| Profile | 秒算マネー、夜話アーカイブ、雨晴はうの人類観測所 |
| Topic | 企画テーマ（一次資料の論点単位） |
| Run | 1 回の制作 |
| Script / Segment | 台本と尺を持つ単位 |
| Source / Claim | 一次資料と、そこから引く主張 |
| Asset | 音声・映像・サムネイル |
| AuditCheck | 監査項目の結果 |
| Video / Publication | 公開された動画と、その公開試行 |
| Metric | 公開後の実測値 |

関係:

- Run → Script（produces）、Script → Segment（contains）
- Claim → Source（cites）。主張は必ず一次資料を指す
- Run → AuditCheck（gated_by）
- AuditCheck → Publication（gates）。FAIL があれば公開に進めない
- Publication → Video（publishes）、Video → Metric（measured_by）

### アクション（規律ある書き込み）

オブジェクトの状態変更は、事前条件を持つアクションだけで行う。

- `prepare_run`: Run を作り、Script と Asset を生成する
- `publish`: 全 AuditCheck が PASS、`task release:check` が PASS、公開先ガード（ADR-0038）を満たす場合だけ実行する。read-back で検証してから完了とする
- `schedule`: `publish_at` を設定する。publish と同じ事前条件を要求する

## Foundry に相当する部分の扱い

Palantir Foundry 本体は有料の SaaS であり、Technology policy により新規の有料契約は追加しない。
同じ考え方（Raw → Transform → Object → Action の分離と系譜追跡）を、このリポジトリ内で SQLite と版管理された変換で実装する。
Foundry の採用は、ユーザーが契約を明示的に承認した場合に限り検討する。

## 用語と governance

- 本案で使う語彙は、`docs/standard/ontology-standard.md` に従い「local domain vocabulary」と明記する。
- ISO 準拠を主張しない。

## 移行計画（段階的、各段階で既存の動作を変えない）

1. P0: `config/ontology/` にオブジェクト型と関係を YAML で定義する。`task audit:ontology` で整合性を検査する。
2. P1: Star 層を読み取り専用のビューとして既存テーブルから作る（`runs`、`audit_checks`、`youtube_analytics`）。
3. P2: 既存の `prepare` と `publish` の処理を、アクションとして包む。事前条件の検査を追加する。
4. P3: 旧テーブルへの直接書き込みを段階的に止め、アクション経由に統一する。

各段階で `task check:merge:fast` を通し、read-back で動作を確認する。

## 未決事項

- DB の分割単位（`db/evolution.db` 一本か、profile ごとか）
- Byosan の run 単位データが DB にあるか、ファイルにしかないか（`runs/` の実態調査が必要）
- 既存 ADR 0027（Evolution DB schema v2）との関係。更新で足りるか、新規とするか
- 監査 FAIL 時の扱い（公開を止めるだけか、Topic を再生成するか）

## 証拠の状態

- VERIFIED: `db/schema.sql` の構造、`publication_state.ts` と `youtube_analytics` の存在。
- UNVERIFIED: 現在の DB の実データ量、Byosan の run データの所在、各テーブルの利用状況。
- 本文書は設計案であり、いずれの実装も行っていない。
