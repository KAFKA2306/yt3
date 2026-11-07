# ADR-0046: Irodori-TTS v4.1 のローカル導入（sandbox）

## Status

Accepted（導入手順と単発合成まで検証済み。2026-11-07: upstream `Aratako/Irodori-TTS` を `sandbox/Irodori-TTS-v4.1` に clone、`uv sync --frozen`、`infer.py --hf-checkpoint Aratako/Irodori-TTS-v4.1-Small --no-ref` で 4.76 秒・mono・48kHz の WAV を生成。`--ref-wavs` に smoke WAV を参照として与えた生成も 5.0 秒・48kHz で成功。yawa の daily 全体（台本、TTS、動画、メタデータ）は未検証）

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
- Issue #221（導入）

## 2026-11-07 追記: 実行経路を ComfyUI に切替

- yawa の TTS は、Irodori-TTS CLI（`infer.py`）から ComfyUI のローカル API（`scripts/yawa_comfy_tts.py`）に切り替えた。CLI の経路は削除した（二重経路を作らない）。
- ComfyUI 本体は `~/projects/comfyui/ComfyUI`（upstream Comfy-Org/ComfyUI、GPL-3.0）。Irodori の node は `laksjdjf/Irodori-TTS-ComfyUI`（MIT）を `custom_nodes/` に置き、`IRODORI_TTS_PATH` で本リポジトリの sandbox clone を参照する。
- node が ComfyUI 0.44 と合わないため、node 側に 3 点の追随修正を入れた（ComfyUI 側の作業ツリー内。本リポジトリには含まれない）。
  1. `core/loader.py`: upstream `irodori_tts` の戻り値が 4 要素になったため、先頭 3 要素を受け取る。
  2. `core/model_wrapper.py`: `IrodoriLatentFormat.fix_empty_latent` を追加（ComfyUI が要求）。
  3. `nodes/guider.py`: `IrodoriGuider.cfg = 1.0` を追加（ComfyUI core が参照）。
- 検証（2026-11-07）: 参照なし（3.08 秒）と `--ref-wav` 付き（5.32 秒）の双方で 48kHz mono の音声を生成。yawa の TS から呼ぶ経路は `bun test` の 21 件が PASS。
- 参照 WAV は ComfyUI の input へコピーしてから読ませる。出力は FLAC を ffmpeg で 48kHz mono WAV に変換する。
- preflight は ComfyUI の `/system_stats` 到達を確認する。ComfyUI が停止していれば止まる（自動起動はしない）。
- カバー画像は `codex-imagegen`（`~/.local/bin`、本リポジトリ外）で生成する。codex の built-in 画像生成を使い、生成物を要求サイズに合わせる。
- 未検証: yawa の daily 全体（YouTube 認証情報が無いため preflight が止まる）。音声 QA（ASR）と動画生成は、この経路では未実行。
