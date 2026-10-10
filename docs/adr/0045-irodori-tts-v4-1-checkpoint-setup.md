# ADR-0045: Irodori-TTS v4.1 のローカル導入（sandbox）

## Status

Accepted（導入手順まで。音声生成の実行は未検証）

## Context

夜話（yawa）の音声は、Irodori-TTS v4.1（`Aratako/Irodori-TTS-v4.1-Small`）で生成する。v4.1 は v4-Small の duration predictor を再学習した小改良版で、コードの変更なしに既存の interface（Voice Clone、Voice Design、絵文字スタイル制御）を使える。Joyo Kanji Yomi Benchmark の Standard CER は v4.1 が 4.69%、v4-Small が 5.35% である。

ADR-0004 の方針（`sandbox/Irodori-TTS` に導入し、`src/` には入れない）を、v4.1 にも適用する。

## Decision

1. 公式リポジトリ `Aratako/Irodori-TTS` を `sandbox/Irodori-TTS` に clone する（`main`、v4/v4.1 対応を確認済み）。
2. 依存関係は `uv sync` で入れる。`UV_CACHE_DIR=.uv-cache` を使う（ADR-0004 準拠）。
3. チェックポイントは `checkpoints/v4.1-small/` に取得する。取得元は `Aratako/Irodori-TTS-v4.1-Small`（6 ファイル、`model.safetensors` 約 3.06GB）。
4. 生成は `infer.py` で行う。既定は `--no-ref` と `--caption` を使い、`--seed` を固定する。

## Consequences

- 導入の手順は確認できた。`uv sync`（exit 0）と、チェックポイントの取得（6/6 完了）は VERIFIED。
- 音声生成（`infer.py` の実行）と、台本 01 の読み上げ確認は UNVERIFIED。自動モードの分類器が「Code from External」として実行を拒否したため。解消条件は Issue で管理する。
- `sandbox/` と `checkpoints/`、`outputs/`、`.uv-cache/` は Git の管理対象外とする。Gitleaks 検査と push protection の対象は、このディレクトリに含めない。

## Related

- [ADR-0004](./0004-irodori-tts-evaluation-and-usage.md)（Irodori-TTS の評価と利用の基準）
- [ADR-0020](./0020-irodori-tts-stability-protocol.md)（安定性の手順）
- Issue #221（導入）
