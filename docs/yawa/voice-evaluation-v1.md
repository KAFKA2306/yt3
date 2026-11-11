# Yawa Archive 音響嗜好評価 v1.0

## Status

Python音響評価器と日次profile巡回を実装。参照音声の収集、参照モデルの構築、本人の好みの学習は未実施。

目的は、Yawa Archive 向けに選んだ声の「高音・鼻にかかる響き・甘さ・若々しい印象・抑揚」を測定し、候補間の好みを予測すること。声優本人の同一性や声真似の再現度は評価しない。

## 参照群と観測単位

- **中心群**: ユーザーが指定した13人。人物ごとの平均声ではなく、特定のキャラクター、台詞、演技をひとつの観測として扱う。
- 中心群の人物: 悠木碧、古賀葵、田村ゆかり、釘宮理恵、阿澄佳奈、竹達彩奈、堀江由衣、野中藍、豊崎愛生、加藤英美里、伊藤かな恵、井口裕香、喜多村英梨。先頭3人は初期比較対象、残る10人は追加選択として由来を記録する。
- **許容範囲群**: 以前挙げた10人を別グループに置く。現在の作業情報に10人の名前がないため、名前や音声は推測で補わない。同一人物の別名・表記揺れは一つの `performer_id` に統合する。
- 観測キーは `performer_id × character_id × line_id × performance_id`。同じ人物の複数録音は平均で潰さず、役・台詞・感情・発話様式を保持する。
- 使用音源は適法に取得できた公開サンプル、ライセンス済み資料、またはユーザー提供素材に限定する。音源はGitに入れず、本人の声の模倣を目的とする学習にも使わない。
- Yawa向け評価では「若々しい印象」を成人の声として明確に表現する。未成年らしさの再現・分類は評価軸にしない。

## 評価軸と測定

| 軸 | 数値特徴 | 人手評価・注意 |
| --- | --- | --- |
| 高音 | 有声音フレームのF0中央値、P05/P95、中央値からの半音差 | 270〜280Hzはユーザーの初期目標。Praat filtered autocorrelationで測定し、初期設定はfloor 100Hz、top 800Hz、10ms刻み。範囲外の音声は切り捨てず、無声判定率も報告する。 |
| 鼻にかかる響き | 母音区間のA1−P0、F1帯域幅。可能ならnasalanceを補助測定 | 同じ母音・同じ音韻環境で比較する。F1帯域幅はPraat Formant (burg)で測定し、母音区間CSVを付ける。A1−P0は高F0時に不確かなので手動計測値のみ受け付け、話者・母音差のため単独の絶対値を「鼻声点」にしない。 |
| 甘さ | HNR、H1−H2、スペクトル傾斜、息成分率を候補特徴として記録 | 甘さは物理量だけで定義できない。匿名のブラインド試聴で「甘さ」を1〜5評価し、音響特徴との関係を学習する。 |
| 若々しい印象 | F0、F1〜F3、話速などを記録 | 数値だけで年齢を推定しない。成人として明確に聞こえるかを含め、ブラインド評価で採点する。 |
| 抑揚 | 半音換算F0レンジ、F0変化速度、句頭・句末輪郭、語尾の上昇/下降 | 台詞・句境界を揃えて比較する。長さや読み内容の違いによる影響を分離する。 |
| 演技の強弱 | RMSのP10/P90幅、有声音率、ポーズ率、話速、句間ポーズ長 | 「強弱」の人手評価と併記する。RMSは録音ゲインの影響を受けるため、元音源値とラウドネス正規化値を区別する。 |
| 歯擦音 | `/s/`・`/ɕ/` 区間の高域エネルギー比（例: 4–10kHz / 0.5–4kHz）と隣接母音との差 | 同じテキストと区間で比較し、ディエッサー前後の数値と聴感を両方残す。処理で子音の明瞭さが落ちたら不採用。 |
| 音響品質 | peak/clipping率、DC offset、異常な無音、ASR文字誤り率 | 声の好みと分離した品質列にする。ASRは読みの明瞭さを示す補助指標で、音質や演技の代理にはしない。 |

母音区間と歯擦音区間は、Praat TextGridで手動または確認済みアライメントを付ける。無音を含む全波形から鼻音特徴を直接推定しない。

## スコアの作り方

### v0: 参照群との音響近似度

参照ベクトルは8特徴量で構成する。`f0_median_semitone`, `f0_p95_p05_semitone`, `f0_change_median_semitone_s`, `hnr_median_db`, `spectral_tilt_db_octave`, `rms_p90_p10_db`, `low_energy_frame_rate`, `high_frequency_energy_ratio_db`。距離の尺度 `σᵢ` はコードにある初期値 `[3, 4, 6, 6, 4, 6, 0.15, 6]` を使う。

候補 `x` と参照録音 `k` の距離は `dₖ = sqrt((1/8) × Σᵢ ((fᵢ(x) − rₖᵢ) / σᵢ)²)`。`d_min = minₖ dₖ`。`d50` は同じグループ内で、話者本人を除いた最近傍参照距離を話者ごとに集約し、その中央値を取る。録音数の多い人が校正尺度を支配しないようにする。最終値は `S_ref = 100 × exp(−ln(2) × (d_min / d50)²)` とする。

中心群と許容範囲群は別々に算出する。許容範囲群の名前が揃うまでは、そのスコアを出さない。この0〜100は参照群との**音響近似度**であり、好みの予測確率ではない。

### v1: 本人の好み予測

日次profileと音声は匿名IDで提示し、5軸を各1〜5、全体の好みを1〜5で記録する。将来の予測値は `S_pref = 100 × P(Y ≥ 4 | features, profile)` と定義し、複数のブラインド評価を集めた後にだけ学習・校正する。今はデータがないためPython出力の `preference_prediction` は `null`。参照音響近似度を好みの確率と表示しない。

話者埋め込みや人物IDは嗜好予測の入力にしない。同じ参照録音や同じ日次profileが学習・検証へ漏れないよう、評価時は日付profile周期単位で分割する。

## 実験手順

1. 同じ短い日本語テキストを用意する。母音「あいうえお」、サ行、句末、通常速度とゆっくりした発話を含め、読みと録音条件を固定する。
2. 日次生成は成人の声のまま、6つの声質profileと現行の基準profileを合わせた7つを日付で巡回する。高音、鼻にかかる響き、甘さ、抑揚、息遣い、演技の強弱を一日一軸ずつ変える。基準profileも1週間に一度含め、同じ日の再試行は同じprofile・seedになる。
3. 各profileの日次reference候補は既存の3 seedから選ぶ。Caption全文、model ID、seed、reference SHA-256、ASR類似度をrunの `voice_experiment.json` に残す。ASRは読みやすさの選抜に限り、好みの選抜には使わない。
4. 候補から同一話者の短いクリーンな複数クリップを選び、合計約30秒の参照を作る。未処理原音を保存し、ディエッサー処理は別ファイルで行う。
5. 参照音声を使い、公式モデルID `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` で同じ評価台詞を生成する。これは隔離した実験runのみで行う。「Large 4.1」は公式モデル名として確認できないため、記録にはモデルIDを使う。
6. 1か月後にユーザーが好みのrun IDやprofileを返したら、`feedback.template.csv` に記録し、好みprofileを更新する。フィードバックまで日次生成と公開は通常経路で継続する。

同じ日に複数profileを作るときは別々の `SLOT` を使い、`YAWA_VOICE_PROFILE` でprofileを指定する。日次既定デバイスはCPU。`YAWA_TTS_DEVICE=cpu` はIrodoriのモデルとcodecを明示的にCPU実行し、そのrunではGPU空き容量条件を使わない。`YAWA_TTS_DEVICE=cuda` を指定したrunだけGPU空き容量条件を確認する。自動でデバイスを切り替えることはなく、実行デバイスはrun記録に残す。例: `YAWA_VOICE_PROFILE=high_bright YAWA_TTS_DEVICE=cpu task yawa:daily DATE=2026-11-11 SLOT=highbright`。

モデル候補の検索・seed探索・補正・Large試験は `runs/yawa_voice_lab/<run-id>/` に隔離し、日次既定値や公開済み音声を自動変更しない。採用後にのみ日次設定変更を別途行う。

## Python実装案

Python環境は `tools/yawa-voice-eval/pyproject.toml` と `uv.lock` で固定する。依存は `praat-parselmouth`（PraatのPitch/Formant/HNR処理）、`numpy`、`soundfile`。ParselmouthはPraatのC/C++実装へ直接アクセスする。

入力manifestは `docs/yawa/voice-reference-manifest.template.csv` を使う。`sample_id`, `group`, `performer_id`, `performer_name`, `character_id`, `line_id`, `performance_id`, `audio_path`, `source_url`, `rights_note`, `vowel_intervals_csv`を持つ。母音区間CSVは手動確認済みの開始・終了・母音ラベルを含める。元音声、manifest、対応表はローカル限定にする。

CLIは `extract`, `build`, `score`。出力は `features.json`（音響量）、`reference_features.csv`（参照の測定値）、`reference_model.json`（ローカル参照モデル）、`score.json`（近さと品質情報）に分ける。参照録音が未入力なら `build` はエラーで止まり、架空の数値を補わない。日次TTSはこの評価器の成功・失敗に依存させない。

```bash
uv run --project tools/yawa-voice-eval --frozen python tools/yawa-voice-eval/voice_physics.py extract reference.wav
uv run --project tools/yawa-voice-eval --frozen python tools/yawa-voice-eval/voice_physics.py build references.csv --output runs/yawa_voice_lab/reference_model.json
uv run --project tools/yawa-voice-eval --frozen python tools/yawa-voice-eval/voice_physics.py score candidate.wav --model runs/yawa_voice_lab/reference_model.json
```

日次runでは選択した約30秒のreferenceを同じ抽出器で測り、`voice_features.json` と `voice_experiment.json` に記録する。特徴抽出が使えない場合は理由を記録し、TTS・公開の成否には影響させない。1か月後の評価は `voice-feedback.template.csv` に `run_id` と好みを記入して紐付ける。

## 技術根拠

- Praatは発話のF0・イントネーション測定にfiltered autocorrelationを推奨し、話者に合わせてpitch floor/topを設定する。
- A1−P0、F1帯域幅、スペクトル傾斜は鼻音化の候補指標だが、母音・話者間の基準差があるため条件を揃えて比較する。
- Irodori v4系の公式資料は、同一話者の複数の短い参照クリップを推奨し、合計約30秒で類似度向上の多くが得られたと報告している。
- Largeの通常モデルは13.2GB。RTX 3060世代に対応するINT4量子化版があり、公式カード記載の重み容量は2,818 MiB。LargeはGemma Termsの対象なので利用規約も確認する。

参照: [Praat filtered autocorrelation](https://praat.org/manual/pitch_analysis_by_filtered_autocorrelation.html), [Parselmouth documentation](https://parselmouth.readthedocs.io/en/stable/index.html), [Chen 1997: Acoustic correlates of English and French nasalized vowels](https://pubmed.ncbi.nlm.nih.gov/9348695/), [Irodori-TTS v4.1-Small model card](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Irodori-TTS v4-Large model card](https://huggingface.co/Aratako/Irodori-TTS-v4-Large), [Irodori-TTS v4-Large quantized model card](https://huggingface.co/Aratako/Irodori-TTS-v4-Large-Quantized).
