# ADR 0032: Zero-Trust Artifact Attestation & Provenance Chain

## 📝 プロベナンス表示 (Claim Provenance)
- **VERIFIED**: ADR-0028, ADR-0029, および ADR-0031 の構造を継承し、監査の決定論的深度を「存在確認」から「真正性・不変性証明」へ昇華させる必要性を特定した。
- **OBSERVED**: 現行システムではアーティファクト間の因果関係（Hash Chain）や、実行時の動的な挙動（Runtime Trace）の監査が不足している。
- **INFERRED**: AI生成パイプラインにおいて「生成物の正しさ」を保証するには、静的な設定値だけでなく、実行時の全工程を暗号学的および行動学的に追跡可能（Attestable）にする必要がある。

## 状態
決定済み（Accepted）

## 文脈
ADR-0031 で確立した「ドメイン分離」をより強固なものとし、AIによる「偽の検査」や「サイレントな汚染」を構造的に排除する。単にファイルが存在するだけでなく、それが「正しい環境で、正しい手順によって、意図した通りに」生成されたことを数学的・論理的に証明するための「ゼロトラスト監査 v2」仕様を定義する。

## 決定事項

### 1. 不変実行マニフェスト (Immutable Run Manifest)
Run 開始時に、その実行の「全入力条件」を固定し、ハッシュ化したマニフェスト（`run_attestation.json`）を保存する。
- **固定対象**:
  - `ENV_HASH`: 使用された `.env` ファイルの SHA-256。
  - `CONFIG_HASH`: `default.yaml` およびプロンプトファイルの SHA-256。
  - `GIT_COMMIT`: 実行時の HEAD hash。
  - `DEPENDENCY_LOCK`: `bun.lockb` および `uv.lock` の整合性チェック。

### 2. アーティファクト・ハッシュチェーン (Artifact Hash Chain)
各工程の出力（Artifact）を SHA-256 で連鎖させ、因果関係を証明する。
- `Script (Hash A)` → `Audio (Hash B, depends on A)` → `Video (Hash C, depends on A+B)`
- 監査フェーズにおいて、チェーンが途切れている（中間ファイルが手動で改ざんされている等）場合は、即座に Publish をブロックする。

### 3. 実行時アテステーション (Runtime Attestation)
「何をしたか」の自己申告ではなく、「実際に実行されたコマンドとパラメータ」をトレースする。
- **Trace Logger**: `ffmpeg` の全引数、`Voicevox` への API リクエストボディ、`YouTube API` への送信メタデータをそのまま RAW データとして `evidence_raw.json` に記録する。
- **Negative Verification**: 許可されたドメイン以外の要素（別ドメインの話者IDやロゴ等）が「存在しないこと」を証明する。

### 4. 公開後アテステーション (Publish Attestation)
動画アップロード完了直後に、YouTube API から実際に公開された情報を再取得（Re-fetch）し、生成時の意図（Metadata）と完全一致しているかを確認する。
- **照合項目**: `videoId`, `channelId`, `privacyStatus`, `thumbnailHash`。
- 一致しない場合は、即座に Alert を発報し、手動介入を強制する。

### 5. 監査者の独立性 (Verifier Independence)
ジェネレーター（生成ロジック）が監査者（AuditAgent）を直接操作・上書きできないよう、監査結果（`audit/result.json`）は追記専用（Append-only）または最終工程での一括署名（Integrity Check）を想定した構造とする。

## 帰結
- **利点**:
  - 監査の信頼性が「静的チェック」から「暗号学的・行動学的証明」へ向上。
  - サイレントなバグや、プロンプトインジェクションによる「意図しないドメイン混入」を確実に検知可能。
- **代償**:
  - 実行時のオーバーヘッド（ハッシュ計算や API 再取得）が増加する。
  - 手動での「ちょっとした修正（ファイルの差し替え）」が監査を壊すため、すべての修正をパイプライン経由で行う規律が求められる。
