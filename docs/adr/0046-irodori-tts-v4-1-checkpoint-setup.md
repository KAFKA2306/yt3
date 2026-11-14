# ADR-0046: Irodori-TTS v4.1 のローカル導入（sandbox）

## Status

Accepted（導入手順と単発合成まで検証済み。2026-11-07: upstream `Aratako/Irodori-TTS` を `sandbox/Irodori-TTS-v4.1` に clone、`uv sync --frozen`、`infer.py --hf-checkpoint Aratako/Irodori-TTS-v4.1-Small --no-ref` で 4.76 秒・mono・48kHz の WAV を生成。`--ref-wavs` に smoke WAV を参照として与えた生成も 5.0 秒・48kHz で成功。yawa の daily 全体（台本、TTS、動画、メタデータ）は未検証）

## Context

夜話（yawa）の音声は、Irodori-TTS v4.1（`Aratako/Irodori-TTS-v4.1-Small`）で生成する。v4.1 は v4-Small の duration predictor を再学習した小改良版で、コードの変更なしに既存の interface（Voice Clone、Voice Design、絵文字スタイル制御）を使える。Joyo Kanji Yomi Benchmark の Standard CER は v4.1 が 4.69%、v4-Small が 5.35% である。

ADR-0004 の方針（`sandbox/Irodori-TTS` に導入し、`src/` には入れない）を、v4.1 にも適用する。

## Decision

- 本番の音声合成は `scripts/yawa_irodori.py` が Irodori-TTS のランタイムを呼び、作品中の音声を一度のモデル読込で生成する。チェックアウト、チェックポイント、キャッシュ、デバイスは `config/yawa/runtime.yaml` に指定する。対象ホストでは Irodori-TTS 側で `uv sync --frozen --extra cu128` を実行する。
- 参照の有無、演技、任意の発話秒数は作品の台本から渡す。台詞とキャプションはチェックポイントのトークナイザーと上限で検証する。
- カバーは作品固有の指示を `codex-imagegen` に渡す。準備と公開は既存の `task yawa:prepare` と `task publish` を使う。

## Related

- [ADR-0004](./0004-irodori-tts-evaluation-and-usage.md)（Irodori-TTS の評価と利用の基準）
- Issue #221（導入）
