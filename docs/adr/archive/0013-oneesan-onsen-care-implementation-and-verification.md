# 優しい年上お姉さんが、風邪ひいたあなたを温泉旅館で朝まで甘やかし看病してくれるASMR: 実装と検証

この文書は `docs/adr/0007-oneesan-onsen-care-script.md` に統合済みのため、履歴として archive に退避する。

## Context

`/home/kafka/2511youtuber/v3/yt3/runs/2026-05-10/publish_new_work/` で、Safe 寄りの超長編 ASMR を自律生成し、Whisper 逆文字起こしで検証する運用を確立した。

## Decision

以下を制作の標準として確定した。

- `voice_caption.md` に固定 `voice caption` を置く
- `script_master.md` には TTS で読む本文のみを置く
- `build_audio.sh` で 4 パート生成して `final_mix.wav` を結合する
- `verify_whisper.sh` で `uv run --with faster-whisper` 経由の ASR 検証を行う
- `final_mix.wav` と `asr_quality_report.md` を成果物として残す

## Implementation

### Voice Caption

`/home/kafka/2511youtuber/v3/yt3/runs/2026-05-10/publish_new_work/voice_caption.md` に、声質を固定するための単一 caption を保存した。

### Script Master

`/home/kafka/2511youtuber/v3/yt3/runs/2026-05-10/publish_new_work/script_master.md` に、以下を分離して保存した。

- 台本本文
- Voice Identity
- Voice Caption

### Audio Build

`/home/kafka/2511youtuber/v3/yt3/runs/2026-05-10/publish_new_work/build_audio.sh` を更新し、次を標準化した。

- 4 パート生成
- `seed: 2306`
- `num-steps: 12`
- `final_mix.wav` の連結

### Whisper Verification

`/home/kafka/2511youtuber/v3/yt3/runs/2026-05-10/publish_new_work/verify_whisper.sh` を更新し、次を標準化した。

- `uv run --with faster-whisper`
- `run_asr.py` による逆文字起こし
- `diff_segments.py` による意味損傷評価

## Result

- `final_mix.wav` を再生成した。
- Whisper 検証を実行した。
- `asr_quality_report.md` を生成した。

## Verification Outcome

- 検証フローは完走した。
- 一部の HIGH 判定は残った。
- ただし、音声生成から逆文字起こしまでの一連の自動化パイプラインは成立した。

## Consequence

今後の同種制作では、以下を初期条件として再利用できる。

- `voice_caption.md`
- `script_master.md`
- `build_audio.sh`
- `verify_whisper.sh`
- `asr_quality_final/asr_quality_report.md`

## Follow-up

最終最適化版は [archive/0014-oneesan-onsen-care-final-optimization.md](/home/kafka/2511youtuber/v3/yt3/docs/adr/archive/0014-oneesan-onsen-care-final-optimization.md) に置く。
