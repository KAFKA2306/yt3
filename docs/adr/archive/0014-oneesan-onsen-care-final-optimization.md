# 優しい年上お姉さんが、風邪ひいたあなたを温泉旅館で朝まで甘やかし看病してくれるASMR: 最終最適化

この文書は `docs/adr/0007-oneesan-onsen-care-script.md` に統合済みのため、履歴として archive に退避する。

## Context

`/home/kafka/2511youtuber/v3/yt3/runs/2026-05-10/publish_new_work/` において、Safe 寄りの超長編 ASMR を制作し、Whisper 逆文字起こしで検証する反復を行った。

## Decision

以下の最終構成を採用した。

- `voice_caption.md` に固定 caption を保存する
- `script_master.md` には Whisper 比較用の短文台本を保存する
- `build_audio.sh` は 10 パート生成を行う
- `verify_whisper.sh` は `uv run --with faster-whisper` で検証する

## Implementation

### Short Sentence Splitting

ASR の崩れを減らすため、台本を短文単位に分割した。

### Ten-Part Build

`build_audio.sh` は 10 個の音声パートを生成し、`ffmpeg` で `final_mix.wav` を結合する。

### Whisper Loop

`verify_whisper.sh` により `run_asr.py` と `diff_segments.py` を実行し、生成音声と `script_master.md` の差分を評価する。

## Result

- `final_mix.wav` を再生成した。
- Whisper 検証を再実行した。
- `asr_quality_report.md` を更新した。

## Verification Outcome

最終検証では `HIGH` は解消し、`MEDIUM` が 3 件残った。

残差の性質は以下だった。

- 1 文内の結合がやや強い
- 耳かきパートの語順が一部崩れる
- 章境界のつながりが少し残る

## Consequence

この制作では、次の改善原則が有効だった。

- 長文を短文化する
- 音声生成単位を小さくする
- Whisper 比較対象を生成単位と一致させる

今後の同種制作では、この ADR を最終最適化版として参照する。
