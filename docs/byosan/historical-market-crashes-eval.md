# 秒算マネーの歴史比較台本を再現する評価

評価基準 v0.2。対象は [Issue #538](https://github.com/KAFKA2306/yt3/issues/538) の調査から、秒算マネーで制作に渡せる日本語台本を作る能力。候補は GPT-6 Astra（`gpt-6-astra`）。比較対象は現行の GPT-6.1 Terra（`medium`）と[参照原稿](https://github.com/KAFKA2306/yt3/blob/e2741a079863b057e9ec66a82d2a6b5fe4d16dad/config/productions/historical_market_crashes.json)。本評価は収録前の台本を扱う。視聴後の評価には [#416](https://github.com/KAFKA2306/yt3/issues/416) の実測を使う。

## 試行の条件

- 各モデルに、同じ依頼、同じ版の資料本文・図表、同じ台本スキーマを渡す。モデルに渡す資料は別ディレクトリに置き、参照原稿・採点表・正解・前回出力へのアクセスを遮断する。この試行では外部検索を止め、渡した資料を読み取る能力を測る。検索技能を測るときは、同じ情報取得権限で別に試行する。
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
- 追記する評価記録は `rubric_version`、`case_id`、`trial_id`、資料・原稿ハッシュ、モデル／推論設定、採点者、必須条件の結果、軸別の点数と根拠、修正記録、総合判定。基準の版はGitで管理し、実行結果は[既存の台帳規約](../standard/ledger-standard.md)に従って追記する。現時点の測定結果は未実施。日次制作の合否は既存ルールに従う。

評価方法の参照出典は[OpenAI Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)、[Anthropic Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)、[GPT-6 Astraモデル仕様](https://developers.openai.com/api/docs/models/gpt-6-astra)。説明欄の長さは[YouTube Data APIの仕様](https://developers.google.com/youtube/data/reference/rest/v3/videos)による。


## UNIXツールの構成

生成、制作入力の検査、編集評価を別々に実行し、各段階が読んだファイルと出力を残す。AstraとTerraは同じ生成経路を使い、出力を保存してから、モデルを再度呼ばずに制作入力を検査する。

| 段階 | 使うもの | 入力 → 出力 |
| --- | --- | --- |
| 入力の固定 | シェル、`sha256sum`、Bunと既存のZod | 課題・原典・モデルに渡す資料・`ByosanFeatureDraftSchema` → 資料の版とハッシュ、同一のプロンプト、Zodから出力したJSON Schema |
| 生成 | OpenAI公式 `codex exec` | 標準入力から課題と資料 → 1試行1件の `trial.json`、標準エラー、終了コード。AstraとTerraで作業領域を共有せず、試行ごとに新規セッションを使う |
| 制作入力の検査 | Bunでyt3の既存関数を呼ぶ | `draft.json` と元資料 → スキーマ・出典・数値の検査、シーン、読み上げ計画、説明欄のバイト数 |
| 根拠と編集の採点 | 上記の採点表と原典。集計は `jq` | 台本・正解資料 → 必須判定、軸別の点数、該当する台詞と参照箇所。一括再採点やJUnitが必要な場合はPromptfooの保存済み出力モードを使う |

yt3が持つのは、課題、資料の指定版、判定基準、既存関数を呼んだ結果を1試行1行のJSONにする接続部分。Bunに渡す入口は試行のファイルを読み、結果を標準出力、実行上の診断を標準エラーへ出す。検査の中身は既存関数を使う。意味上の照合には、この文書の正解と原典を使う。たとえば、22.6%という値が入力にあっても、NYダウかS&P 500かは、台詞の該当箇所と出典を突き合わせて判定する。

### 公式CLIで1試行を作る

`EVAL_INPUT` は参照原稿・正解・制作資格情報を持たない評価専用作業環境、`EVAL_OUT` は採点側に渡す新規の試行ディレクトリ。いずれも絶対パスを指定する。Codexがモデルへの通信に使う認証は実行環境のものを使う。評価用プロファイルでMCP・アプリ・プラグインを無効にし、モデルが読み取れるファイル範囲も確認する。読み取り専用サンドボックスは書き込みを制限するための設定で、参照原稿を隔離するには評価専用環境のファイル配置とアクセス権が必要。

```sh
umask 077
codex exec --cd "$EVAL_INPUT" --skip-git-repo-check --ephemeral \
  --sandbox read-only -c 'web_search="disabled"' \
  --model "$EVAL_MODEL" -c "model_reasoning_effort=\"$EVAL_EFFORT\"" \
  --output-schema "$EVAL_INPUT/trial.schema.json" \
  --output-last-message "$EVAL_OUT/trial.json" - \
  < "$EVAL_INPUT/prompt.txt" > /dev/null 2> "$EVAL_OUT/codex.stderr"
```

`trial.schema.json` は既存のZodスキーマを `draft` に再利用し、根拠メモを `evidence` とした出力を定義する。既存検査に渡す台本は `jq -e .draft trial.json > draft.json` で取り出す。`evidence` の各行は、主張ID、資料IDと版、ページ・節・表のいずれか、計算式（派生値の場合）、確認状況を持つ。集計用JSONLは1試行1行とし、`rubric_version`、`case_id`、`trial_id`、`requested_model`、`resolved_model`、`status`、`hard_fail_count`、`editorial_scores`、根拠への参照を記録する。`status` は `pass`、`fail`、`run_error`、`not_run` のいずれか。終了コードが失敗のときは出力が残っていても採点に進めない。認証、利用上限、モデル利用不可は実行障害として記録する。モデルが回答して内容が不合格だった試行とは区別する。実行障害が残る状態では18件を完了したと判定しない。モデルIDは要求値と実行側が確認できた値を別に記録し、後者が確認できない場合は未確認とする。生成サービスとの通信は必要。保存済みファイルの決定的検査と `jq` による集計はローカルで再実行できる。初回合格率は合格数と予定試行数、3回連続合格は合格した課題数と予定課題数を併記する。実行障害と未実施の件数は別欄に出す。

### 保存済み出力をPromptfooで確かめる

最初の比較はCodex、Bun、`jq`で実行できる。一括再採点やJUnitが必要になったときは、保存済みの台本をPromptfooに渡す。例では同一課題の出力を1セットとして扱い、ファイル名と試行IDの順序を記録する。プロバイダーやLLM採点を使わない場合の例。

```sh
jq -Rs '[.]' draft.json > outputs.json
PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 \
  promptfoo eval --assertions assertions.yaml --model-outputs outputs.json \
  --no-cache --no-share --no-table --no-progress-bar \
  -o results.json -o results.junit.xml
```

実行は出力を置いたディレクトリから行い、上の相対パスを使う。Promptfoo 0.125.1で、本物のJSONと平文を渡す `is-json` の確認を実施。期待どおり1件ずつ合格・不合格となり、JSONとJUnitが生成された。これは再採点の接続確認で、台本の意味やモデル性能の確認ではない。同バージョンでは絶対パスの `--model-outputs` が作業ディレクトリの下に解決されて失敗した。評価用JSONとログに原文が含まれ得るため、共有する集計は試行ID、版、判定など必要項目だけを `jq` で抽出する。

実行の初期構成はCodex CLI、Bun、`jq`。一括再採点はPromptfooに委ねる。並列実行やモデルの呼び出し管理も委ねる段階では、Promptfoo組み込みの `openai:codex-app-server` を候補とし、独立試行・権限・実際のモデル指定を確認してから切り替える。

ツールの根拠は[OpenAIのCodex非対話モード](https://learn.chatgpt.com/docs/non-interactive-mode)、[Codexの設定とネットワーク](https://learn.chatgpt.com/docs/agent-approvals-security)、[jqマニュアル](https://jqlang.org/manual/)、[OpenAIのPromptfooガイド](https://developers.openai.com/api/docs/guides/promptfoo-codex)、[Promptfooの保存済み出力モード](https://www.promptfoo.dev/docs/configuration/expected-outputs/#running-assertions-directly-on-outputs)、[エクスポート仕様](https://www.promptfoo.dev/docs/configuration/outputs/)、[Codex App Server連携](https://www.promptfoo.dev/docs/providers/openai-codex-app-server/)。
