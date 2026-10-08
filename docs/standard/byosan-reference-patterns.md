# 秒算マネー: 外部動画の設計パターンを監査可能な契約にする

更新: 2026-10-08
参考チャンネル: [AI時短ラボ](https://www.youtube.com/@ai_jitan_lab)

## 目的と境界

外部チャンネルの「面白い説明の構造」を借りる。ただし、他チャンネルの数字・未公開仕様・企業の動機推測は yt3 の事実として取り込まない。引用元が動画で述べたことと、公式一次資料で確認した事実は別の証拠段階とする。

- 再生数 / 登録者数はインプレッション数ではない。再生数の大きさだけから YouTube 推薦アルゴリズムを突破したと推定しない。
- 他者の実験、推測、取材情報、将来予定は yt3 の実測や確定事実へ昇格させない。
- 利用許諾が必要な API や有料プランでの実測は、事前の明示的許可がない限り実行しない。新規課金サービスは前提にしない。
- 企業の「本音」「真の狙い」は複数の説明仮説として扱い、観測事実とは分離する。
- 外部動画の尺や投稿本数は固定要件にしない。フォーマットは yt3 の angle evidence で決める。

## 単一の正準フロー

```text
source/event
  -> existing angle/research evidence (L1-L5 source IDs)
  -> negative evidence + conditions + counterfactual
  -> existing format selector (#72)
  -> existing grounded packaging (#73)
  -> evidence-bundled narrative archetype
  -> Presenter -> Auditor -> bounded conclusion (#74 / #82)
  -> existing feature-spec audit / Verifier / release gate
  -> existing publication path
  -> first_7d analytics as soft preference (#76)
  -> existing weekly/monthly digest reuse (#75)
```

新しい DB、LLM 分類器、TTS、publisher、verifier authority は追加しない。

## 既存の設計資産

| 外部研究から取り込む構造 | 現行の正準実装 | 必須の境界 |
| --- | --- | --- |
| 速報 / 比較 / 深掘り / 通常解説 | `news_angle.ts` | 時点と比較条件が揃ったときだけ採用 |
| 強いタイトルとサムネイル | `feature_spec.ts` | 出典のない最大・最安・速報を FAIL |
| 反証と脚注の提示 | `news_angle.ts`, `feature_spec.ts` | ソース ID と対象 claim に接地 |
| 敵対的二話者 | `feature_spec.ts` | 相槌だけで監査完了にしない |
| 多様なナラティブ | `narrative_archetype.ts` | 各型の required slots を evidence で裏付け |
| 週次・月次再編集 | `digest_contract.ts`, `build_byosan_digest.ts` | 異なる版のスコアを混在させない |
| 視聴結果による改善 | `performance_evaluation.ts` | first_7d のみ、品質 hard gate は不変 |
| 能動的検証 | `active_probe.ts`, `run_byosan_probe.ts` | 認可・実測・再現方法を残す |

## 追加した `active_falsification` ナラティブ

ニュースの伝聞を積み重ねるのではなく、**仮説を反証できる観測**を起点にする。次の7スロットを順序付きで要求する。

1. `target_claim`: 検証したい主張
2. `probe_method`: 測定条件と実施方法
3. `observation`: `VERIFIED` プローブ ID を持つ実測
4. `competing_hypothesis`: 説明可能な対抗仮説
5. `discriminating_test`: `VERIFIED` プローブ ID を持つ識別テスト
6. `falsification_boundary`: 反証・測定条件・出典の限界を adversarial evidence ID に接地
7. `bounded_conclusion`: 観測が示す範囲だけの限定付き結論

`sourceIds` の存在確認に加え、観測・識別テストで実測済み ID がない候補は、この型を選択しない。これらは十分条件ではなく、既存の研究・事実監査も引き続き必要。

## トークナイザー指紋の実測境界

以前の `run_byosan_probe.ts` は、入力ファイルに記入されたトークン数のハッシュを `VERIFIED` と記録できた。これは「実機でトークン化した」証拠ではない。

- 現在の `tokenizer_fingerprint` は渡された値をハッシュ化するだけなので `UNVERIFIED` と記録する。
- 既存の監査器も `tokenizer_fingerprint + VERIFIED` を拒否する。
- 将来 `VERIFIED` とするには、対象の実トークナイザーを実行して token IDs / 対象バージョン / 入力セット / 実行記録を残す実装と、監査器の再設計が必要。

## 確認した既存 Issue

[#72](https://github.com/KAFKA2306/yt3/issues/72) ·
[#73](https://github.com/KAFKA2306/yt3/issues/73) ·
[#74](https://github.com/KAFKA2306/yt3/issues/74) ·
[#75](https://github.com/KAFKA2306/yt3/issues/75) ·
[#76](https://github.com/KAFKA2306/yt3/issues/76) ·
[#81](https://github.com/KAFKA2306/yt3/issues/81) ·
[#82](https://github.com/KAFKA2306/yt3/issues/82)

これらの Issue は main 上で closed。個々の受け入れ条件が完全に本番で実証済みであることとは区別する。

## 運用上の完了条件

- [ ] 新たな動画ごとに一次ソース、反証、前提を収集
- [ ] 再生数とインプレッションなど指標の意味を混同しない
- [ ] 自己申告、他者の観察、自分の実測の帰属を区別
- [ ] 全 material claim を既存 factual gate で監査
- [ ] 少なくとも1本を実 run で処理し、episode / media / audit / release evidence を確認
- [ ] 7日実績が十分に集まるまでは効果未検証として扱う
