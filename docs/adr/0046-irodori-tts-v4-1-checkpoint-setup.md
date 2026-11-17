# ADR-0046: Irodori-TTS v4.1 のローカル導入と声リファレンス作成フロー

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

## 手動の声リファレンス作成フロー

Muse からローカル生成環境を使った試行で得た、Yawa 向けの手動手順を記録する。これは現在の `task yawa:daily` の実装変更ではない。

1. `Aratako/Irodori-TTS-v4.1-Small` を `--no-ref` で使い、anime 系の caption と複数の seed で候補を作る。採用する caption は実際に使った全文を記録する。今回共有されたのは caption の傾向までで、再現用の全文は未共有。
2. 候補を聴き比べて選ぶ。270〜280 Hz 帯はオーナー個人の好みの目安として扱い、合否条件にはしない。サ行などの歯擦音と息のようなノイズも確認する。
3. 選んだ候補の原音を残したまま、別コピーにディエッサーを適用する。処理後も聴き直し、歯擦音が弱まりつつ発音の明瞭さが保たれているものを reference にする。プラグイン名、バージョン、設定値を記録する。共有された試行では特定の処理設定までは確認できていない。
4. その reference を使って本番テキストを Large checkpoint で生成する。caption は reference の声質と矛盾させず、演技やスタイルの指定に使う。Irodori-TTS は reference waveform と caption の両方を受け取れる。
5. 再現用に model ID と revision、caption、seed、reference の SHA-256、原音と処理済み音声の対応、ディエッサー設定、本番生成の seed と model ID を run の記録に残す。音声ファイル自体は既存の run 成果物の扱いに従い、Git には追加しない。

公式の Large checkpoint は `Aratako/Irodori-TTS-v4-Large` という ID で、v4.1-Small とは別のモデル名である。このリポジトリの `irodori-v4-large` も同 ID を指定している。「Large 4.1」がこの v4-Large を指すかは未確認のため、記録には通称でなく model ID を使う。Large は T5Gemma 2 encoder を含み Gemma Terms の対象なので、利用時は公式 terms と prohibited-use policy に従い、本人の明示的な同意なしに個人の声を模倣せず、誤認させる合成音声に使わない。

参照: [v4.1-Small model card](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small)、[v4-Large model card](https://huggingface.co/Aratako/Irodori-TTS-v4-Large)、[Irodori-TTS parameter guide](https://github.com/Aratako/Irodori-TTS/blob/main/docs/parameters.md)、[Gemma Terms of Use](https://ai.google.dev/gemma/terms)、[Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy)。

## 日次自動フローとの境界

- 現在の `config/yawa/daily.yaml` は `irodori-v4.1-small` を既定にし、reference 候補を 3 つ生成する。候補は ASR 類似度で自動選択され、日次生成では同じ設定済み backend が使われる。
- 日次フローには人による候補の聴き比べ、ディエッサー処理、処理済み reference の指定はまだ組み込まれていない。上の手動手順を実施した run を、日次フローで再現済みとは扱わない。
- 2026-11-11 に `phasefield-audio/Irodori-TTS-v4.1-Anime` revision `6b259f5baa5e236b3d14cbd1f8555ca87d92b530` と `Aratako/Irodori-TTS-v4-Large-Quantized` revision `bdef9592db4426bd1c99ccdf0cfc3a213223fb61` の重み・tokenizer等を `HF_HOME` に取得した。これらは実験候補で、日次 backend は引き続き `irodori-v4.1-small`。音声推論は未実施。確認時のGPU空きVRAMは1,476 MiBで、日次preflightの6,000 MiBを下回っていたため、推論可否・速度・音質は未検証。Largeを既定backendへ変更しない。

## Related

- [ADR-0004](./0004-irodori-tts-evaluation-and-usage.md)（Irodori-TTS の評価と利用の基準）
- Issue #221（導入）
