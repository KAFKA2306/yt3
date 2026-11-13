# Yawa Archive 音響嗜好評価 v1.0.2

## Current production design (2026-11-13)

The previous date-rotated voice profiles, common low/dry caption, fixed situation-pattern picker, and fixed chapter-shape endings are retired from production. `config/yawa/daily.yaml` now stores independent voice axes (register, resonance, sweetness, phonation, articulation, and prosody). Each run samples each axis from its own seeded, preference-weighted distribution. Preference weights express the owner's stated starting direction; they are not learned probabilities or hard targets. F0 270–280 Hz remains one exploration cue, not a generation gate.

The reference text stays the same across voice runs so candidate voices can be compared on the same words. Each run samples 3–5 reference seeds, records ASR readability and acoustic measurements for every candidate, and selects by ASR only as a readability proxy. It does not rank personal preference. `experience_evaluation.json` keeps readability, acoustic measurements, pending owner voice feedback, and story-specificity observations in separate fields; none blocks production or publication.

New episodes no longer select historical situation patterns or fixed arc arrays. Their scene axes are sampled independently, and the script model creates a situation, chapter order, and ending from that episode's specific listener experience. Historical YAML pattern entries remain only to interpret older runs. Segment count follows the story; the TTS chunk-size limit and adult-only, rights, provenance, and reproducible-seed records remain operational safeguards.

## Status

Python音響評価器はPraat/Parselmouth 0.4.7を `uv.lock` で固定し、日次runのreference音声からF0、スペクトル、フォルマントを記録する。音響計測とASRは参考値であり、本人の好みは聴取フィードバックが届くまで未学習・未確定。2026-11-13に独立音響軸と場面起点の自由構成へ更新した。以前の設計経緯は[調査記録](./voice-situation-design-research-2026-11-12.md)に記録する。

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
| 高音 | 有声音フレームのF0中央値、P05/P95、中央値からの半音差 | 270〜280Hzはユーザーの初期目標。Parselmouth `Sound.to_pitch_ac` で測定し、初期設定はfloor 100Hz、ceiling 800Hz、10ms刻み。範囲外の音声は切り捨てず、無声判定率も報告する。 |
| 周波数スペクトル | 300–10,000Hzのスペクトル重心・85%ロールオフ・スペクトル平坦度、スペクトル傾斜、高域/低域エネルギー比 | 40ms窓・10ms hopで計算し、ピークから35dB以内のフレームの中央値を記録する。録音、母音、音量に依存する参考値であり、好みや音質の合否判定には使わない。 |
| フォルマント | F1/F2/F3とF1帯域幅 | 母音区間未注釈の場合も、有声音フレームのPraat Burg推定値を `formant_estimates_unsegmented` に探索値として記録する。子音遷移を含み母音ごとの測定ではないため、参考値に限る。注釈済み母音区間の値とは別フィールドに保存し、鼻声・年齢の断定に使わない。 |
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

日次音声は匿名run IDで提示し、音響特徴ごとの印象（高さ、共鳴、甘さ、息、明瞭さ、抑揚）と、声全体の好みを別々に記録する。将来の予測値は `S_pref = 100 × P(Y ≥ 4 | features, selected_axes)` と定義し、複数のブラインド評価を集めた後にだけ学習・校正する。今はデータがないためPython出力の `preference_prediction` は `null`。参照音響近似度を好みの確率と表示しない。

話者埋め込みや人物IDは嗜好予測の入力にしない。同じ参照録音や同じ声条件のseedが学習・検証へ漏れないよう、評価時はrun IDとseedの組で分割する。

## 実験手順

1. 同じ短い日本語テキストを用意する。母音「あいうえお」、サ行、句末、通常速度とゆっくりした発話を含め、読みと録音条件を固定する。
2. 日次生成は成人の声のまま、音域・共鳴・甘さ・発声・明瞭さ・抑揚を独立に組み合わせる。好みの方向は重み付けし、低音などの対照も探索から除外しない。同じrunを再実行すれば軸とseedは再現される。測定値は参考情報で、ゲートにしない。
3. 各runは同一の参照台詞で3〜5 seedの候補を作る。Caption全文、選択軸、model ID、seed、reference SHA-256、ASR類似度、候補別F0・スペクトル・フォルマント等をrunに残す。ASRは読みやすさの参考に限り、好みの選抜には使わない。好みは同じ台詞の聴き比べと所有者フィードバックで決める。場面軸は独立抽選し、モデルがその回の目的から状況・章順・終わり方を作る。旧パターンは歴史比較以外に使わない。
4. 候補から同一話者の短いクリーンな複数クリップを選び、合計約30秒の参照を作る。未処理原音を保存し、ディエッサー処理は別ファイルで行う。
5. 参照音声を使い、公式モデルID `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` で同じ評価台詞を生成する。これは隔離した実験runのみで行う。「Large 4.1」は公式モデル名として確認できないため、記録にはモデルIDを使う。
6. 1か月後にユーザーが好みのrun IDやprofileを返したら、`feedback.template.csv` に記録し、好みprofileを更新する。フィードバックまで日次生成と公開は通常経路で継続する。

## 日次制作と比較実験のループ

日次投稿では声の嗜好、聞き取りやすさ、場面固有性を別々に記録する。1回の結果から「この声条件が好まれた」と因果を断定しない。日次制作・投稿は継続し、音響値、ASR、多様性診断は投稿可否ゲートにしない。

特定の差を確かめるときは `voice-lab-run-spec.template.yaml` を `runs/yawa_voice_lab/<run-id>/run-spec.yaml` にコピーし、生成前に次を記録する。

1. **問いと基準**: 何を変えた候補を何と比べるか。直近の「良かった回」だけでなく、同じ条件の基準候補を用意する。
2. **揃える条件**: 台詞、Irodori checkpoint、参照音声、サンプリング設定、音量処理を明記する。声captionの効果を見たいなら参照音声を固定し、参照音声の効果を見たいならcaptionを固定する。両方を変える場合はその組み合わせを別条件として記録する。
3. **seedの反復**: 候補と基準に同じseed列を使って対にする。まず3組を目安にし、1組しか作れない場合は探索メモとし、優劣を確定した扱いにしない。
4. **結果の保存**: 成功・失敗を含めてrun仕様、実際の設定、音声hash、測定値、実行環境の差をrun directoryに残す。失敗runも消さず、失敗理由と次回に試すことを書く。
5. **比較と申し送り**: 同一条件の基準、前回、これまでの最良候補を並べ、seed間の中央値と幅を見る。単発の上振れは改善と呼ばず、繰り返して確認できた結果だけを次の設定変更の根拠にする。確認できていないことは次runの問いに残す。

日次runの `voice_experiment.json`、`experience_evaluation.json`、`selection.json` は実条件の記録として使い、管理された比較実験の代わりにはしない。フィードバックでは声・場面・台本・全体を別々に評価し、声だけの評価と作品全体の好みを混ぜない。軸の重みは聴取結果を記録してから更新し、実験結果を公開の合否条件にしない。

同じ日に複数runを作るときは別々の `SLOT` を使う。`YAWA_VOICE_PROFILE` による固定profile指定は廃止した。日次既定デバイスはCPU。`YAWA_TTS_DEVICE=cpu` はIrodoriのモデルとcodecを明示的にCPU実行し、そのrunではGPU空き容量条件を使わない。`YAWA_TTS_DEVICE=cuda` を指定したrunだけGPU空き容量条件を確認する。自動でデバイスを切り替えることはなく、実行デバイスはrun記録に残す。

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

日次runでは選択した約30秒のreferenceを同じ抽出器で測り、`voice_features.json` と `voice_experiment.json` に記録する。`voice_features.json` はParselmouthバージョン更新時に再測定される。F0、スペクトル、フォルマントの数値は参考情報で、特徴抽出が使えない場合も理由を記録してTTS・公開の成否には影響させない。1か月後の評価は `voice-feedback.template.csv` に `run_id` と好みを記入して紐付ける。

## 技術根拠

- Praat公式資料は発話のF0・イントネーション測定にfiltered autocorrelationを推奨する。一方、採用中の安定版Parselmouth 0.4.7はPraat 6.1.38を同梱し、このfilteredコマンドが利用できないため、実装は `Sound.to_pitch_ac` と明示的なfloor/ceilingを使う。測定器の出力には実際のAPI名を記録する。
- A1−P0、F1帯域幅、スペクトル傾斜は鼻音化の候補指標だが、母音・話者間の基準差があるため条件を揃えて比較する。
- Irodori v4系の公式資料は、同一話者の複数の短い参照クリップを推奨し、合計約30秒で類似度向上の多くが得られたと報告している。
- Largeの通常モデルは13.2GB。RTX 3060世代に対応するINT4量子化版があり、公式カード記載の重み容量は2,818 MiB。LargeはGemma Termsの対象なので利用規約も確認する。

参照: [Praat filtered autocorrelation](https://praat.org/manual/pitch_analysis_by_filtered_autocorrelation.html), [Parselmouth documentation](https://parselmouth.readthedocs.io/en/stable/index.html), [Chen 1997: Acoustic correlates of English and French nasalized vowels](https://pubmed.ncbi.nlm.nih.gov/9348695/), [Irodori-TTS v4.1-Small model card](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Irodori-TTS v4-Large model card](https://huggingface.co/Aratako/Irodori-TTS-v4-Large), [Irodori-TTS v4-Large quantized model card](https://huggingface.co/Aratako/Irodori-TTS-v4-Large-Quantized).
