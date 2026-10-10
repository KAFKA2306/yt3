# Issue #160: AI時代、人間に残る「8つの価値」の企画整理

対象: GitHub issue #160「【動画企画】AI時代、人間に残る「8つの価値」― 100職種の現場知を構造化する」

このファイルは企画・正規化方針の文書であり、動画の完成・公開・検証済みの事実を示すものではない。事実主張はすべて「仮説」または「UNVERIFIED」として扱う。

## 1. 前提と未検証事項

- UNVERIFIED: issue は「100職種」を入力とするが、リポジトリ内に職種事例の元データは存在しない（`docs/planning/` 新規、既存の human-value 関連ファイルは検索で0件）。本書の正規化対象は issue 本文に例示された職種 54 件（重複除去後）に限る。
- UNVERIFIED: 「AIが〇〇できない」「責任を負えない」等の能力判断は、本書では事実として使わない。構造上の仮説として扱う。
- 本書作成では WebSearch を行っていない。外部の統計・技術動向を主張に使う場合は、動画化の前に別途出典確認が必要。

## 2. 核心の主張（仮説ラベル付き）

| 主張 | ラベル |
|---|---|
| 人間の価値は職種名ではなく工程・責任単位で分解すると見えやすい | 仮説 |
| 人間の残存価値は8原理に圧縮できる | 仮説（issue 本文の分類案） |
| 観測・介入・責任の分離が難しい領域では、人間が現場の観測系・制御系の一部として残りやすい | 仮説 |
| 文化的価値は生成物の品質だけでなく provenance / creator / context に依存する | 仮説 |
| 責任の移転はモデル出力から自動では起きず、決定・説明・責任主体を設計する必要がある | 仮説（制度面は UNVERIFIED） |

強い断言（「AIにはできない」）は使わない。issue の Framing に従い、「現在のデジタル入力では不足する」「責任主体は別レイヤーで必要」の形に限定する。

## 3. 8分類の定義と代表例

primary taxonomy（dataset の enum 名）と対応づける。各分類は issue の例示から最低3件を動画で扱う。

| # | 分類 (enum) | 定義 | 動画で扱う代表例（3件以上） |
|---|---|---|---|
| 1 | BODY_SENSING | 未センサー化の微弱な現実を身体で拾う | 和菓子、杜氏、装蹄師、調香 |
| 2 | CLOSED_LOOP_CONTROL | 観察→操作→反応→再調整を短周期で回す | 麻酔、クレーン操作、ピアノ調律 |
| 3 | OOD_RESPONSE | 訓練データ・マニュアルの外側で弱い兆候を統合して判断する | トンネル切羽、山岳救助、航空事故調査 |
| 4 | INTENT_INTERPRETATION | 言葉の外側（沈黙・関係・文化・場）から真の要求を読む | 心理職、ソムリエ、法廷通訳 |
| 5 | TRUST_FORMATION | 関係そのものが成果に影響する | 助産、盲導犬訓練、グリーフケア |
| 6 | PHYSICAL_PRESENCE | 身体を現場へ投入できることがボトルネックになる | 海底ケーブル、送電線保守、林業 |
| 7 | AUTHENTICITY_MEANING | 誰が・どの歴史を背負って作ったかが価値になる | 金継ぎ、能、文化財修復 |
| 8 | IRREVERSIBLE_RESPONSIBILITY | 判断後に元へ戻せず、決定・説明・責任の主体が必要 | 医療、航空整備、司法 |

## 4. 正規化: 職種 → primary / secondary

重複は1 occupation に統合し、複数の場面は `scene` として持つ。以下は issue 本文に現れた職種 54 件。

| occupation | primary | secondary（例） |
|---|---|---|
| 和菓子 | BODY_SENSING | AUTHENTICITY_MEANING |
| 杜氏 | BODY_SENSING | AUTHENTICITY_MEANING |
| 装蹄師 | BODY_SENSING | CLOSED_LOOP_CONTROL |
| 左官 | BODY_SENSING | CLOSED_LOOP_CONTROL |
| 超音波検査 | CLOSED_LOOP_CONTROL | BODY_SENSING, OOD_RESPONSE, IRREVERSIBLE_RESPONSIBILITY |
| 潜水作業 | PHYSICAL_PRESENCE | BODY_SENSING |
| 調香 | BODY_SENSING | AUTHENTICITY_MEANING |
| 麻酔 | CLOSED_LOOP_CONTROL | IRREVERSIBLE_RESPONSIBILITY |
| クレーン操作 | CLOSED_LOOP_CONTROL | PHYSICAL_PRESENCE |
| 義肢調整 | CLOSED_LOOP_CONTROL | TRUST_FORMATION |
| ピアノ調律 | CLOSED_LOOP_CONTROL | BODY_SENSING |
| プロペラ調整 | CLOSED_LOOP_CONTROL | BODY_SENSING |
| 鍼 | CLOSED_LOOP_CONTROL | BODY_SENSING |
| トンネル切羽 | OOD_RESPONSE | BODY_SENSING, PHYSICAL_PRESENCE |
| 航空事故調査 | OOD_RESPONSE | IRREVERSIBLE_RESPONSIBILITY |
| 山岳救助 | OOD_RESPONSE | PHYSICAL_PRESENCE |
| 核融合炉運転 | OOD_RESPONSE | IRREVERSIBLE_RESPONSIBILITY |
| 病理 | OOD_RESPONSE | BODY_SENSING |
| 野生動物医療 | OOD_RESPONSE | TRUST_FORMATION |
| 災害現場 | OOD_RESPONSE | PHYSICAL_PRESENCE |
| 心理職 | INTENT_INTERPRETATION | TRUST_FORMATION |
| ソムリエ | INTENT_INTERPRETATION | BODY_SENSING, AUTHENTICITY_MEANING |
| 司書 | INTENT_INTERPRETATION | |
| ガイド | INTENT_INTERPRETATION | TRUST_FORMATION |
| 法廷通訳 | INTENT_INTERPRETATION | IRREVERSIBLE_RESPONSIBILITY |
| 児童福祉 | INTENT_INTERPRETATION | TRUST_FORMATION, IRREVERSIBLE_RESPONSIBILITY |
| 演出・音響 | INTENT_INTERPRETATION | AUTHENTICITY_MEANING |
| 助産 | TRUST_FORMATION | BODY_SENSING, IRREVERSIBLE_RESPONSIBILITY |
| 保育 | TRUST_FORMATION | INTENT_INTERPRETATION |
| 獣医 | TRUST_FORMATION | OOD_RESPONSE |
| 盲導犬訓練 | TRUST_FORMATION | CLOSED_LOOP_CONTROL |
| グリーフケア | TRUST_FORMATION | INTENT_INTERPRETATION |
| 義肢装具 | TRUST_FORMATION | CLOSED_LOOP_CONTROL |
| 救急 | TRUST_FORMATION | OOD_RESPONSE, PHYSICAL_PRESENCE |
| 福祉 | TRUST_FORMATION | INTENT_INTERPRETATION |
| 海底ケーブル | PHYSICAL_PRESENCE | |
| 送電線保守 | PHYSICAL_PRESENCE | IRREVERSIBLE_RESPONSIBILITY |
| 足場 | PHYSICAL_PRESENCE | |
| 林業 | PHYSICAL_PRESENCE | BODY_SENSING |
| 海洋調査 | PHYSICAL_PRESENCE | OOD_RESPONSE |
| 鉄道保守 | PHYSICAL_PRESENCE | IRREVERSIBLE_RESPONSIBILITY |
| 金継ぎ | AUTHENTICITY_MEANING | BODY_SENSING |
| 能 | AUTHENTICITY_MEANING | |
| 蒔絵 | AUTHENTICITY_MEANING | BODY_SENSING |
| 文化財修復 | AUTHENTICITY_MEANING | IRREVERSIBLE_RESPONSIBILITY |
| 将棋 | AUTHENTICITY_MEANING | |
| 報道写真 | AUTHENTICITY_MEANING | IRREVERSIBLE_RESPONSIBILITY |
| 伝統建築 | AUTHENTICITY_MEANING | BODY_SENSING |
| 酒造 | AUTHENTICITY_MEANING | BODY_SENSING |
| 医療 | IRREVERSIBLE_RESPONSIBILITY | CLOSED_LOOP_CONTROL, OOD_RESPONSE |
| 航空整備 | IRREVERSIBLE_RESPONSIBILITY | PHYSICAL_PRESENCE |
| 児童保護 | IRREVERSIBLE_RESPONSIBILITY | TRUST_FORMATION |
| 安全管理 | IRREVERSIBLE_RESPONSIBILITY | |
| 司法 | IRREVERSIBLE_RESPONSIBILITY | INTENT_INTERPRETATION |

要確認（dedup 候補）:
- 「児童福祉」「児童保護」「福祉」は統合するか別 occupation とするかを決める。本書では別として扱う。
- 「義肢調整」「義肢装具」は工程が異なるため別とする。
- 「潜水作業」は issue 内で BODY_SENSING と PHYSICAL_PRESENCE の両方に現れる。本書では現場投入（PHYSICAL_PRESENCE）を primary とし、身体の微弱信号は secondary に置く。
- 「超音波検査」は issue の hook で「プローブ探索 → 断面取得」の閉ループとして扱われるため CLOSED_LOOP_CONTROL を primary とした。

## 5. Dataset スキーマ（issue の proposed schema）

```
occupation            正規化名（1件1行）
scene[]               場面（同職種の文章を統合して格納）
human_value_primary   8 enum のいずれか（必須）
human_value_secondary[]
physical_signal[]     例: 匂い・反力・湿度感・音
closed_loop_action    観察→操作→反応→再調整 の記述（該当時のみ）
ood_factor
trust_factor
authenticity_factor
responsibility_factor
ai_assistable_tasks[] AIに任せられる工程
human_retained_tasks[] 人間に残す工程
evidence_status       VERIFIED | UNVERIFIED | 仮説
source                出典 URL または元資料
```

受け入れ条件との対応:
- 全 occupation に primary 1つ以上を割当（本書の表で完了）
- 同一職種は1行に統合し、場面を `scene[]` に分ける
- 身体センシング（`physical_signal`）と閉ループ制御（`closed_loop_action`）は別フィールドにする。混同しない
- Authenticity と Responsibility は独立した factor にする

## 6. 分類ごとの動画での扱い（AI担当 / 人間担当の分離）

各分類について「AIに任せられる工程」と「人間に残る工程」を分けて示す（仮説）。

| 分類 | AIに任せられる工程（例） | 人間に残る工程（例） |
|---|---|---|
| BODY_SENSING | 計測値の比較、画像・データの一次分類 | 匂い・触感・音による微弱信号の拾い上げ |
| CLOSED_LOOP_CONTROL | 候補提示、計測・記録 | 探索・操作の即時調整、反応の読み取り |
| OOD_RESPONSE | 既知パターンの照合 | 弱い兆候の統合、想定外の判断 |
| INTENT_INTERPRETATION | 文字起こし、要約、候補応答 | 沈黙・場・関係からの要求読み取り |
| TRUST_FORMATION | 情報提供、手順の提示 | 関係構築、安心の提供 |
| PHYSICAL_PRESENCE | 計画・経路の提示、遠隔監視 | 現場への身体投入と作業 |
| AUTHENTICITY_MEANING | 生成・複製の補助 | 制作者・来歴・文脈の担保 |
| IRREVERSIBLE_RESPONSIBILITY | 根拠の整理、選択肢の提示 | 決定、説明、責任主体としての引き受け |

## 7. 動画構成（6〜8分の日本語本編）

issue の storyboard を採用する。目安時間:

| 区間 | 内容 | 時間 |
|---|---|---|
| Hook | 和菓子〜海底ケーブルのモンタージュ、「8原理」の提示 | 0:00–0:40 |
| 問題提起 | 職業ランキングが弱い理由、職業→タスク→価値への分解 | 0:40–1:30 |
| 8原理 | 各分類: 定義1行、代表2〜3職種、身体動作、AI担当/人間担当 | 1:30–4:30 |
| 超音波検査の例 | AI vs 人間ではなく AI + human control loop | 4:30–5:30 |
| 価値の移動 | 情報処理→観測→介入→信頼→意味→責任 | 5:30–6:30 |
| 結論 | 知能が安くなるほど身体・現場・関係・真正性・責任の希少性が上がる（仮説） | 6:30–7:30 |

注意: 8原理の紹介は 8 分類 × 3 例以上を扱うため、1分類あたり 20〜25 秒が上限。職種の列挙だけにならないよう、各分類は「身体動作→AI担当→人間担当」の順で1例を深掘りする。

## 8. 表現監査の基準

- 「AIにはできない」「絶対に代替不能」「責任を負えない」等の断定は使わない。
- 主要 claim には「仮説」または出典を付ける。
- 「AI脅威論」「人間礼賛」のどちらにも寄せない。
- 職業ランキング形式にしない。

## 9. サムネイル・タイトル候補

タイトル候補（issue 記載の3案）:
1. AI時代、人間の仕事はどこに残る？ 100職種から見えた8つの共通点
2. AIが賢くなるほど、人間に残る仕事が「身体・信頼・責任」へ寄っていく理由
3. AI時代の人間価値を100職種から分類したら、8種類しかなかった

サムネ文言候補（3案以上を満たす）:
1. 人間に残る8つ
2. AIの次、人間は何をする？
3. 100職種 → 8原理

注意: 「100職種」は元データ未確認のため UNVERIFIED。公開前に事例数を正確な件数へ直すか、表記を「職種事例」に変える判断が必要。

## 10. yt3 パイプラインへの当てはめ（提案）

canonical flow（issue 記載）:

Research corpus → normalized human-value dataset → episode.json → Script → VideoStoryboard → Shot → Render → TTS / ASR QA → visual audit → final video → publish gate

- 本テーマは AGENTS.md の製品区分では `humanity`（雨晴はうの人類観測所）が近いと見えるが、所属製品の決定は未決定。`byosan` / `yawa` と設定・素材・公開状態を分離する必要がある。
- 公開は外部への不可逆な副作用であり、publish gate は明示的な承認なしに実行しない。

## 11. Required Visuals（9点）と対応

| # | 図 | 対応分類 / 節 |
|---|---|---|
| 1 | 100職種→8分類の収束図 | 4節 |
| 2 | Human Value 8分類ホイール | 3節 |
| 3 | AI / Human task decomposition | 6節 |
| 4 | 超音波検査 Human-in-the-loop 図 | CLOSED_LOOP_CONTROL |
| 5 | 身体センシング入力例 | BODY_SENSING |
| 6 | OOD 対応の概念図 | OOD_RESPONSE |
| 7 | Authenticity / provenance 図 | AUTHENTICITY_MEANING |
| 8 | Irreversible responsibility の Decision Gate | IRREVERSIBLE_RESPONSIBILITY |
| 9 | 情報処理→現実接続の価値移動図 | 7節 |

図は drawio など既存の図解ツールで作る方針とし、本書では図の実体は作成していない。

## 12. 未完了項目（この文書の範囲外）

- 元の 100 職種の事例データの入手（UNVERIFIED、リポジトリ内に無し）。入手後に 4節の表へ追記し、dedup を行う。
- 外部出典（統計、制度、技術動向）の収集と `source` 欄への記入。
- 動画本体（台本、Shot、Render、TTS/ASR QA、visual audit）の作成。
- 公開判断と publish gate（明示的承認が必要）。
- 本文の表現監査（8節）の実施。
