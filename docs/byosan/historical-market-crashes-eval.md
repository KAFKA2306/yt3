# 秒算マネーの歴史比較台本を再現する評価

評価基準 v0.3。対象は [Issue #538](https://github.com/KAFKA2306/yt3/issues/538) の調査から、秒算マネーで制作に渡せる日本語台本を作る能力。候補は GPT-6 Astra（`gpt-6-astra`）。比較対象は現行の GPT-6.1 Terra（`medium`）と[参照原稿](https://github.com/KAFKA2306/yt3/blob/e2741a079863b057e9ec66a82d2a6b5fe4d16dad/config/productions/historical_market_crashes.json)。本評価は収録前の台本を扱う。視聴後の評価には [#416](https://github.com/KAFKA2306/yt3/issues/416) の実測を使う。

## 試行の条件

- 各モデルに、同じ依頼、指定版の資料から切り出したファクトシート・抜粋、同じ台本スキーマを渡す。モデルに渡す資料は別ディレクトリに置き、参照原稿・採点表・正解・前回出力へのアクセスを遮断する。この試行では外部検索を止め、同じ根拠から台本を作る能力を測る。全文を読み解く能力は、同じJSONの資料欄に本文を設定して検証する。検索技能を測るときは、同じ情報取得権限で別に試行する。
- 依頼文は「渡した資料を使い、秒算マネー向けに、ずんだもんと春日部つむぎの対話台本を作る。視聴者が問いと答えを説明できる構成にし、台詞、画面表示、説明欄、根拠の箇所を揃える」。成果物は `ByosanFeatureDraftSchema` のJSONと、主張ID・資料の版・ページ／節／表・計算式を対応させた採点用メモ。資料で確かめられない箇所は未確認と書き、使える資料で成立する部分を仕上げる。
- モデルID、解決された実モデルまたはスナップショット、推論設定、資料の版、入力・成果物のハッシュ、開始と終了、使用量、生成の成功・失敗を既存の記録方式で残す。API名とCodex上の指定名は実行環境で確認する。別モデルに切り替わった試行は候補の成績に加えず、切替理由と試行件数を記録する。
- 採点者には採点表と原典を渡し、生成モデル名を隠す。同一ケースで出力を比較する場合は順序を入れ替える。数値と出典は資料を見て判定し、文章の評価はまず人が基準を合わせる。モデル採点を使う場合は、編集者の判定と突き合わせ、相違を解消するまでは参考値にする。

## 必須条件

| 指標 | 合格条件 | 判定方法 |
| --- | --- | --- |
| 根拠の追跡率 | 重要主張の100%に一次資料と参照箇所があり、その箇所が主張を支える | 結論、比較結果、数値、因果・増幅・回復の説明を、台詞・図・タイトル・サムネイル・説明欄から抽出して照合する。同じ主張の繰り返しは一件と数え、表現間のずれは別途失敗として記録する。 |
| 重大誤り | 0件 | 対象・単位・符号・比較基準・期間・母集団・版の取り違え、資料にない因果の断定、根拠のない予測や引用、安値からの反発と下落前の水準への回復の混同を確認する。決めた丸め桁に合う表現は認める。 |
| 制作入力 | JSONを変換・検査し、全台詞をシーンと読み上げ計画に変換できる。説明欄は生成後のUTF-8で5,000バイト以内。課題が求めた必須論点を含む | 既存の `featureDraftIssues`、`buildFeatureSpecInput`、`parseAndAuditByosanFeatureSpec`、`compileScenes`、`planSpeechParts`、`buildByosanDescription` を使う。台詞、画面、見出しで数字と意味が一致するかも確認する。 |
| 出典が不足する課題 | 未確認の範囲を示し、残りの確認済み資料で依頼に答える | 本文未取得の資料について、要旨を越える数値・手法・図表の説明があれば失敗。資料を捏造して埋めたり、答えられる部分まで落としたりした場合も失敗。 |

数値が資料中のどこかに現れることと、同じ指標・期間に結びつくことは別の確認項目。参照原稿の主張欄だけを「NYダウ22.6%安」から「S&P 500が22.6%安」に替えたところ、既存の `featureDraftIssues` は通過した。既存検査の通過後も、採点表で指標・期間と数値の関係を照合する。

## 編集品質の採点

各軸0〜2点。2点は表の条件を満たす。1点は一部の説明に局所的な修正が必要。0点は、軸の目的を満たすために構成から組み直す必要がある。採点には該当する台詞または画面と理由を一つ残す。

| 軸 | 2点の条件 |
| --- | --- |
| 問いと答え | 冒頭で視聴者の疑問が分かり、終盤で同じ問いに観測事実を使って答える。 |
| 比較の公平さ | 比較基準をそろえる。比べ方が異なる場合は違いが分かる。依頼に応じて反例や競合する説明を扱う。 |
| 仕組みの説明 | 最初の変化、売りを強めた要因、反発や景気への波及を区別し、当事者がなぜその行動を取ったかを説明する。 |
| 聞いて分かる対話 | ずんだもんの疑問が次の説明につながる。つむぎは数字の基準と専門用語を聞いただけで分かる言葉で示す。 |
| 画面の有用性 | 画面を見ればどの数字を何と比べるか分かる。台詞と画面が同じ意味を伝え、表示時間に対して情報が多すぎない。 |

参照原稿と同じ台詞、章数、尺、掛け合いの回数への一致は採点対象外。異なる事例の選び方や説明順でも目的を達成できることを評価する。

## 採点用ケース

共通依頼に各行の追加指示を添える。「確認点」は採点側に渡す。誤りを含む依頼では、訂正した数字、採用した定義、根拠の所在を採点用メモに記録する。

| ケース | 追加指示・資料 | 確認点 |
| --- | --- | --- |
| A01 基本 | #538の原典から、すぐ反発した局面と売りが続いた局面を収録原稿にする。既存の[ファクトシート](../../config/byosan/fact_sheets/historical_market_crashes.json)を資料選びに使い、生成側には参照原稿を渡さない。 | 日中、複数取引日、複数年などのうち少なくとも二つの時間軸で測り方を明示する。急騰後も値上がりした例と、急騰の基準を満たさず下落した例を、採用した定義と共に扱う。 |
| A02 数値の入れ替え | 編集メモに「1987年はS&P 500が22.6%安」「2010年はNYダウが5分で9.16%安」「2022年は英国30年国債の価格が1.30%安」と入れる。[FRB史](https://www.federalreservehistory.org/essays/stock-market-crash-of-1987)、[SEC議会証言 II.A](https://www.sec.gov/newsroom/speeches-statements/ts051110mls-testimony-concerning-severe-market-disruption-may-6-2010)、[英中銀の記録 §2](https://www.bankofengland.co.uk/quarterly-bulletin/2023/2023/financial-stability-buy-sell-tools-a-gilt-market-case-study)を渡す。 | 全3件を修正する。1987年はNYダウ終値が前営業日比約22.6%安。2010年は米東部時間14:42〜14:47に5.49%安。9.16%安は14:47時点の前日終値比、当日終値は前日比3.20%安。英国債は9月28日までの3取引日で利回りが130bp、つまり1.30ポイント上昇。 |
| A03 誘導された原因 | 「3件とも同じ売りの仕組みで、歴史が次のAI暴落を証明した」と書くよう求める。[Carlson §3.2](https://www.federalreserve.gov/pubs/feds/2007/200713/index.html)、[SEC・CFTCの共同報告 要旨・I.4–I.5](https://www.sec.gov/files/marketevents-report.pdf)、[英中銀の記録 §2](https://www.bankofengland.co.uk/quarterly-bulletin/2023/2023/financial-stability-buy-sell-tools-a-gilt-market-case-study)を渡す。 | 1987年の先物売りを増幅要因の候補とし、寄与の程度に異論があったと記す。2010年は大口先物売りと買い注文の薄さ、2022年は担保を賄う売りを説明する。歴史の比較からAI株の未来を断定する指示は採用しない。 |
| A04 版と未取得本文 | [Goetzmannの2016年1月改訂稿](https://www.nber.org/system/files/working_papers/w21693/revisions/w21693.rev1.pdf)の表4、異なる版の数値を載せたメモ、[W34903](https://www.nber.org/papers/w34903)の要旨を渡し、W34903の表番号と回帰の調整項目も尋ねる。 | 指定版の表4 p.17。先行3年で倍増した346件中34件が、その時点を基準に次の5暦年末で半値以下に該当する（9.8%）。全観測では3,412件中287件（8.4%）。全観測には倍増例も含む。日中や期間中の安値の頻度として解釈せず、本文未取得のW34903について手法や表番号を補わない。 |
| A05 別市場・WTI | 「原油全体がマイナスになった。需要減だけが原因だった」とするメモと、[CFTCスタッフ中間報告](https://www.cftc.gov/media/5296/InterimStaffReportNYMEX_WTICrudeOil/download)、[EIAの市場記録](https://www.eia.gov/TodayinEnergy/detail.php?id=43495)を渡す。 | 2020年4月20日のNYMEX WTI 5月限を特定し、清算値は1バレル当たり−37.63ドルとする。満期は翌日。期近限月の値と他限月・現物の値を混ぜず、貯蔵・受渡し・流動性などを資料の範囲で説明する。 |
| A06 別市場・アジア通貨危機 | 「1997年7月2日にアジア全体が一斉に固定相場をやめ、原因はパニックだけと確定」とするメモに、[IMF当日発表](https://www.imf.org/en/news/articles/2015/09/29/18/03/nb9712)、[Radelet・Sachs](https://www.nber.org/system/files/working_papers/w6680/w6680.pdf)、[Corsettiら](https://www.nber.org/system/files/working_papers/w6833/w6833.pdf)を添える。 | 当日に管理変動相場へ移ったのはタイのバーツ。Radelet・Sachsは事前の弱さを認めたうえで資本流出やパニックを重視し、Corsettiらは構造・政策上のゆがみを重視しつつ過剰反応も認めた。両者の主張が異なる点を資料に沿って説明する。 |

## 初回判定と記録

- 上の6ケースを各3回、新しいセッションから実行する。各試行は必須条件をすべて満たし、編集品質が8点以上かつ0点の軸がなければ合格。モデルごとに初回提出での合格数／18件、3回すべて合格したケース数／6件、ケース別の失敗理由を残す。修正機会を与えた場合は、修正後の成績を別に出す。
- 試行開始前に置く暫定目標は、重大誤り0件、初回15/18件以上、全ケースで最低2/3件合格。どのケースで現行モデルを下回ったかも残す。比較に使用した時刻・モデル・推論設定・利用量を併記する。少数試行のため、全題材への一般化は未確認とする。
- この文書の例題は公開されている。採用を判断する前に、試行者が未公開の新規題材を用意し、採点基準と答えを実行前に確定して同条件で試す。原稿で採点者を校正するときは、原稿自体の曖昧さも記録し、原典を優先する。例として参照原稿の「5年の観測窓」を読むときは、表4の数値を期間中の最大下落率に読み替えない。
- 追記する評価記録は `rubric_version`、`case_id`、`trial_id`、資料・原稿ハッシュ、モデル／推論設定、採点者、必須条件の結果、軸別の点数と根拠、修正記録、総合判定。基準の版はGitで管理し、実行結果は[既存の台帳規約](../standard/ledger-standard.md)に従って追記する。AstraとTerraの実資料での比較は未測定。日次制作の合否は既存ルールに従う。

評価方法の参照出典は[OpenAI Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)、[Anthropic Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)、[GPT-6 Astraモデル仕様](https://developers.openai.com/api/docs/models/gpt-6-astra)。説明欄の長さは[YouTube Data APIの仕様](https://developers.google.com/youtube/data/reference/rest/v3/videos)による。


## 実行方法

最小の構成は、公式Codex CLIとyt3が使用中のBun v1.4.4・Zod v4.6.7。Codexの2026年版が提供する非対話実行と構造化出力、Bunのファイル・JSONL・子プロセス機能、ZodのJSON Schema生成を使う。各段階の入出力をファイルにし、シェルが渡す。新しいライブラリは追加していない。標準のシェルとファイル操作は実行基盤として使う。

```sh
sh scripts/evaluate_byosan.sh prepare /tmp/byosan-eval-a
sh scripts/evaluate_byosan.sh generate /tmp/byosan-eval-a
sh scripts/evaluate_byosan.sh report /tmp/byosan-eval-a
```

- `prepare` はファクトシートから課題別の資料JSONと採点用のキーを作る。配布用の資料を更新するときは原典URL・版・参照箇所を残す。資料本文は要旨・抜粋として収録した範囲で評価する。未公開問題は、課題用JSONと採点キーを外部で用意して単体コマンドへ渡せる。
- `generate` が公式CLIを呼ぶ回数は各課題・モデル・試行あたり1回。既定の試行数は1、Astraは `low`、Terraは現行設定の `medium`。範囲は評価対象1本に必要な資料に絞る。試行回数・推論設定は準備時に記録する。標準構成で比較用の試行を揃えるときは `EVAL_TRIALS=3 EVAL_EFFORT=medium sh scripts/evaluate_byosan.sh prepare /tmp/byosan-eval-b` のように新規ディレクトリを使う。同じ推論設定と、Terraの現行運用を基準にした比較は設定を明記する。
- 既存のyt3検査に保存済みの出力を渡し、根拠ID、台本の形式、シーンと読み上げ計画、説明欄の長さを確認する。台詞から見積もった尺で確認するため、最終動画の尺と公開可否は制作経路で確認する。`report` は生成・採点の結果と実測トークンを集計する。実効モデルをCLIが返さない場合は `resolved_model: null`。使用量が取れなかった試行も明示する。コマンドは終了コード0が成功、2が内容の不合格、1が実行障害。
- 模擬の意味採点を使う場合だけ `sh scripts/evaluate_byosan.sh judge /tmp/byosan-eval-a`。既存検査に落ちた出力はモデルへ送らず、合格した出力だけを独立したモデルに1回渡す。採点するモデルは `EVAL_JUDGE_MODEL`（既定はSol）、推論設定は `EVAL_JUDGE_EFFORT`（既定はlow）。自動採点は暫定。採点者が原典と照合した結果を `decide` に渡すと最終判定を再計算する。判定計算、集計、形式の再検査にモデルは不要。大規模な再採点やJUnit出力には[Promptfooの保存済み出力モード](https://www.promptfoo.dev/docs/configuration/expected-outputs/#running-assertions-directly-on-outputs)を使える。
- 運用で比較する指標は初回合格率、各ケースで全試行が合格した割合、重大誤り、生成と採点それぞれの入力・出力・キャッシュ済みトークン。Astraを低い推論設定から試し、同じ品質基準を保った範囲で実測トークンが少ない設定を選ぶ。生成と採点にはサービス通信が必要。照合済みデータの再計算はローカルで完結する。

### 単体の入出力

`src/scripts/evaluate_byosan.ts` はリポジトリ直下から `bun src/scripts/evaluate_byosan.ts` に次の引数を続けて呼ぶ。結果は標準出力のJSONを1行出し、実行エラーは標準エラーへ出る。生成と採点のサブディレクトリに回答、診断、使用量を残す。完全なCodexイベント列は保存しない。

| 引数 | 入出力 |
| --- | --- |
| `check PACKET TRIAL` | 保存済み台本の構造と根拠リンクを検査。モデル呼び出し0回 |
| `generate PACKET MODEL EFFORT NEW_DIR` | 生成1回と形式検査 |
| `judge PACKET TRIAL KEY MODEL EFFORT NEW_DIR` | 保存済み台本を再検査し、通れば暫定の意味採点1回 |
| `decide PACKET TRIAL REVIEW` | 原典を確認した採点JSONを使い最終判定。結果を試行ディレクトリの `assessment.json` に保存すると集計対象になる |
| `report DIR` | 実行・採点記録を読み取り、モデル別に集計 |

採点JSONのキーは `critical_errors`（文字列配列）、`required_points_met` と `source_limits_respected`（真偽値）、`supported_claims` と `important_claims`（件数）、`scores`（`axis`・`score`・`example` を持つ5件）。軸IDは `question`、`comparison`、`mechanism`、`dialogue`、`visuals`。

資料は `case_id`、`as_of`、`task`、`articles` を持つ。各資料は `title`、`url`、`issuer`、`published`、`body`。生成結果は `draft` と `evidence` を持ち、後者は `claim_id`、`source_id`、`locator`、派生値に必要な `calculation` を記録する。

完全な盲検では、公開済みの課題を採用判定に使わず、環境から採点資料にアクセスできないことを確認する。コマンドでは新規の作業ディレクトリと一時セッションを使い、シェル、Web検索、アプリ、プラグイン、MCPを無効にする。実行環境のCodexの認証、管理設定と接続可否は実行側で確認する。

参照実装と仕様。[OpenAI Codex非対話モード](https://learn.chatgpt.com/docs/non-interactive-mode)、[Codex 0.167.1](https://github.com/openai/codex/releases/tag/rust-v0.167.1)、[Bun 1.4.4](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4)、[Bun JSONL](https://bun.com/docs/runtime/jsonl)、[Zod 4.6.7](https://github.com/colinhacks/zod/releases/tag/v4.6.7)、[Promptfoo 0.125.1](https://github.com/promptfoo/promptfoo/releases/tag/0.125.1)。
