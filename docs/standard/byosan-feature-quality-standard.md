# 秒算マネー特集動画 品質標準

この標準は、単発のプロンプト改善ではなく、制作物を検証して次の実装へ戻す `agent improvement loop` / `harness design` の一部として使う。

## 実行層: agent loop

1. 一次資料ごとの claim matrix を作る。
2. 冒頭30秒でタイトルとサムネの約束を明示する。
3. 感情ラベルから VOICEVOX の話速・ピッチ・抑揚・間を決める。
4. 1発話1シーンで、数値・話者・指差し対象を同期する。
5. 最大2行の字幕、1080p映像、48kHzステレオ音声を生成する。

## 検証層: closed-loop agent workflow

公開候補は、次をすべて満たした場合だけ合格とする。

- 音声品質: 統合ラウドネス -19〜-10 LUFS、True Peak -0.5 dBTP以下、3秒超の無音なし。
- 映像品質: H.264 High、1920×1080、BT.709、30fps、目標8Mbps、AAC 48kHz stereo。
- つかみ: 冒頭の場面（`audit.opening_segment_count`）が、主要主張の数値（`+2.1%` など）を意味として回収する。文字列の全文一致は要求しない。
- 内容: 全ての重要主張が一次資料に紐づき、概算と公式開示を明確に分ける。区別（確認済み・派生値・推計）と限界は claims の構造化フィールドに保持し、概要欄の「根拠と限界」と画面の出典表示で示す。台詞への逐語的な転記は要求せず、会話の中で自然に一度触れる。
- イントネーション: 台本の感情ラベルはすべて音声プリセットを持つ。種類数の下限は設けない。
- 字幕: 1キュー最大2行、可読サイズ、1キュー0.84秒以上を目安にする。
- 場面: 1場面の音声は `audit.max_scene_seconds` 以内。長い台詞は描画前に文の切れ目で分割し、話速は `scenes.chars_per_second` で見積もる。分割された場面は話者・感情・見出し・主張を引き継ぎ、数値カードは最初の場面だけに出す。
- 動き: カメラ移動・ズーム・パン・回転・周期的な揺れは禁止する。発話ごとの静止シーン切替、字幕、数値カード更新だけを許可する。静止区間の検出は診断情報として保存し、意図した静止画面を欠陥扱いしない。
- 感情表現: 驚き、疑問、核心、注意、納得、結論が台本と音声と画面で一致する。
- ジェスチャー: キャラクターの指差し、ポインター、数値カードの対象を一致させる。
- サムネ: 文字を小画面で読め、動画冒頭が約束をすぐ回収する。

出典は画面上に媒体名・資料名・公開日・URLを読める大きさで表示する。他社の図・画像・チャートは転載せず、数値の元データから自作した図で再描画する。

## 継続改善層: agent improvement loop / harness design

失敗は `audit/production_quality_report.json` に要件別で残す。再制作時は、失敗した要件を台本、音声プリセット、字幕分割、映像レンダリング、公開ゲートの実装変更へ変換する。公開結果と視聴維持率が得られたら、冒頭30秒の離脱、トップモーメント、サムネとタイトルの整合を次の eval に追加する。

## 台本検査の停止条件

台本の検査は、事実・数字・出典に関するものだけを停止条件にする。停止条件は `config/domains/byosan_money.yaml` の `feature_review.blocking_codes` で指定し、`schema_` で始まるスキーマ違反は常に停止条件とする。

- 停止（run を止め、局所修復の対象にする）: 出典にない数字（`unsourced_number`、`explanation_figure_value_missing`）、主張と出典の欠落（`claim_source_missing`）、タイトル・サムネイルの数字が主張に無いこと（`packaging_number_ungrounded`）、第三者検証のない L3 のみの主張に境界文が無いこと（`vendor_claim_boundary_missing`）、台詞への制作メモ語の混入（`production_memo_in_dialogue`）、参照の欠落（`duplicate_source_id`、`*_source_missing`、`packaging_claim_missing`）。
- 警告（run は継続し、結果を `audit/feature_warnings.json` と `audit/explanation_warnings.json` に記録）: 速報・極端表現の裏付け（`freshness_marker_ungrounded`、`relative_claim_ungrounded`）、保留表現（`banned_phrase_in_resolution_or_landing`、`hedged_conclusion`）、probe の観察情報（`active_probe_*`）、ブランドタグ（`brand_tag_missing`）。
- 題材選定の評価閾値は `angle_gate.min_weighted_score` で与える。演出目的の hard gate（反証の検証可能性、probe、narrative archetype の監査、`counterfactual_is_not_testable`）は削除した。
- 台詞の文字数、発話数、文数、文型、場面の順番は検査しない。
- 削除した契約: 編集参照（`editorial_reference_plan`）、narrative archetype の slot 順序の強制、hook promise の検査（`hookPromises` は任意）、claim ごとの caveat・confidence・unresolvedMismatches の必須化、ずんだもんの発話の必須化、packaging の冒頭配置の検査。`packaging` は引き続き必須（produce 側が読むため）。
- 維持した検査: 数字と出典の整合（証拠本文にない数字の却下、数値カードの意味照合）、実績・推計・予測の区別（`status` の列挙）、権利（編集参照を事実源にしないこと）、公開ゲート。

## 根拠として使う仕様

- YouTube audience retention: https://support.google.com/youtube/answer/9314415
- YouTube title and thumbnail tips: https://support.google.com/youtube/answer/12340300
- YouTube upload encoding settings: https://support.google.com/youtube/answer/1722171
- VOICEVOX Engine API: https://voicevox.github.io/voicevox_engine/api/
- Netflix Japanese timed-text guide: https://partnerhelp.netflixstudios.com/hc/en-us/articles/215767517-Japanese-Timed-Text-Style-Guide
- Teachers' motivational prosody — pre-registered experiment: https://pubmed.ncbi.nlm.nih.gov/36464926/
- Inconsistent use of gesture space during abstract pointing impairs comprehension: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.00080/full
- Pointing hand stimuli induce attention and spatial compatibility effects: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00219/full

## 要件別リサーチ対応表

「最高品質」は絶対的な形容ではなく、下記の調査根拠、制作判断、計測可能な公開ゲートを同時に満たす状態として運用する。

| 要件 | 調査から採用した判断 | 制作・検証への反映 |
| --- | --- | --- |
| 音声品質 | YouTube推奨のAAC-LC、48kHz、stereo、384kbpsを採用。ラウドネス値はYouTube公式の固定目標ではないため、プロジェクト運用値として-14.5 LUFS、-1 dBTPを使用 | EBU R128解析、True Peak、長時間無音、発話速度を公開前に測定 |
| 動画品質 | YouTube推奨のH.264 High、4:2:0、1080p標準フレーム8Mbps、BT.709、Fast Startを採用 | ffprobeでコーデック、解像度、色空間、fps、ビットレートを検証 |
| キャッチ | YouTubeは冒頭30秒の残存率とタイトル・サムネとの一致をIntro評価に用いる | 主要数値と二段オチを21.8秒以内に回収 |
| 内容 | FactSet、Amazon/AlphabetのSEC提出書類、Anthropic公式発表を一次資料とする | claim matrixで公式値、派生計算、非GAAP概算を分類 |
| 抑揚 | 査読済みの事前登録実験は、文面を固定しても声色が受け手の反応に影響することを示す。VOICEVOX APIは話速、音高、抑揚、音量、間を制御可能 | 章の役割ごとに10感情プリセットを割り当て、音声manifestへ制御値を保存 |
| テロップ | Netflix日本語ガイドの最大2行・最低0.5秒を下限参考とする | 最大2行、最低0.84秒、68px、行幅、禁則、重複を自動検査 |
| 動き | YouTubeの維持率ガイドは後半のTop momentsを前へ移す改善を推奨。視認性を損なう周期的な揺れはプロジェクト判断で禁止 | 1発話1静止シーン、字幕・数値カード・シーン切替だけを許可し、カメラ移動・ズーム・パン・回転を禁止 |
| 感情 | motivational prosody研究とVOICEVOX制御項目を、感情を音声へ変換する根拠にする | 驚き→疑問→核心→注意→納得→確信→余韻のアークを台本・音声・画面ラベルで同期 |
| ジェスチャー | 指差し位置と発話対象の不一致は理解負荷を増やし、通常の人差し指は強い注意誘導になるという実験結果を採用 | 指差しキャラクター、ポインター線、数値カードの対象を同じ側へ固定し、話者交代時だけキャラクターを切替 |
| サムネ | YouTubeは正確・簡潔なタイトル、可読文字、複雑にしすぎない構図、カスタムサムネを推奨 | 構造化specの主要数値を大階層で表示し、冒頭で回収。API用JPEG、反映attestationを別生成 |

## 日次経路

- 日次の入口は `task byosan:publish-daily`。内部で `task byosan:auto DATE=<Asia/Tokyoの当日>` を実行し、準備ゲートのPASSと3証跡（`[product-release-gate] PASS`、`PUBLISH_READY_RUN`、`PUBLISH_COMMAND`）が同一runで揃い、`publish_approved` が true の場合にだけ `PUBLISH_COMMAND` を実行する。`resume_date` より前の日付は準備・公開しない。公開前の失敗に限り同日に再準備する。`task byosan:auto DATE=<日付>` は準備が失敗すると `task byosan:repair`（codex exec による保守）を挟んで再準備し、準備の総試行回数は `config/domains/byosan_money.yaml` の `auto.max_prepare_attempts` で上限を決めて、上限到達時に停止する。`byosan:publish-daily` は GATE_FAILED の記録がある同日に `task byosan:auto` で再準備する。公開済み・receipt検出時は再準備も再アップロードもしない。`GATE_FAILED` と `PUBLISH_ATTEMPTED` は別状態として扱い、後者や公開の成否が不明な状態からは新規アップロードせず遠隔照合する。
- systemd user timer `yt3-byosan-daily.timer` が毎日 09:00 JST（Asia/Tokyo）に `yt3-byosan-daily.service` を起動し、service は `task byosan:publish-daily` を実行する（失敗時は Discord に audit_fail を通知し、systemd による自動再起動はしない）。
- `task byosan:publish-daily`・`task byosan:auto`・`task byosan:prepare` は最初に `task sync:deps`（`bun install --frozen-lockfile`）で node_modules を bun.lock に同期する。bun.lock が古い場合は停止する。準備の事前検査（preflight）は、秒算マネーの import 元（`src/domain/byosan` と `src/scripts/produce_byosan_feature.ts`）が使う package.json の dependencies が node_modules に実在することを確認し、欠けていれば `node_dependencies FAIL` で止まる。
- `task byosan:daily` は公開せず、研究・制作・監査のみを行う。
- `--dry-run` はスキーマ、基準spec、公開抑止を検証する。
- ニュース候補は5件以上、発行主体3つ以上、直近30日との最大類似度0.42以下を要求する。
- Zodで企画・制作specを検証し、停止条件に当たる違反だけを局所修復と検証エラー付きの再生成で直す（回数は `llm` 設定）。それ以外の検査は警告として記録し、run は止めない。
- 同日のupload receiptを検出した場合は再アップロードしない。公開完了にはreceipt、public visibility、thumbnail attestationを必要とする。企画は複数案検討してよいが、完成・公開対象は当日の1本とする。数字・出典・スキーマの違反は、根拠のない数字を足して通さず、該当する主張や出典を直して修復する。
- **実装監査の留保**：現在の `byosan_publish_daily.ts` は `GATE_FAILED` 後の再準備を許すが、原因修正・テスト完了の機械的証拠をそこで独立確認するとは限らない。自律再試行の安全性は未検証であり、今後の実装確認・テスト対象とする。

## 本物であることの監査

YouTube は収益化の対象として、テンプレートで機械的に量産された内容や、独自の価値が乏しい再利用・反復を制限している。公式の文言は、テンプレートや量産の印象、視聴者が連続視聴で反復と感じる内容、他者の素材の再掲載を、独自の価値の欠如として扱う方向である。本監査は、この趣旨を機械的に検査するための内部基準であり、YouTube の判定を保証するものではない。

根拠ページ（2025-07-15 に "repetitious content" を "inauthentic content" へ改称した経緯、テンプレート生成と反復の定義、再利用の定義）:

https://support.google.com/youtube/answer/1311392?hl=en

根拠ページ（他者の素材の再掲載と、独自の編集・解説を伴わない転載の定義）:

https://support.google.com/youtube/answer/2801973?hl=en

収益化の再利用コンテンツに関する FAQ。本文は未取得で、この基準の根拠としては未検証（UNVERIFIED）:

https://support.google.com/youtube/community-guide/271248162/%F0%9F%94%8E-faq-reused-content-youtube%E2%80%99s-partner-program?hl=en

監査は `src/domain/byosan/authenticity_audit.ts` の純関数 `auditAuthenticity` が行い、`task audit:byosan-authenticity RUN=byosan_money/<run>` が `runs/byosan_money/<run>/audit/authenticity.json` を書く。日次の準備では製作後・リリースゲート前に同じ監査を実行し、リリースゲートは同じ feature_spec の監査 PASS を要求する。

| 指標 | 内容 | 閾値の置き場所 |
| --- | --- | --- |
| 場面の種類 | 異なる場面の種類の数が下限以上 | `scenes.min_distinct_kinds` |
| 同種の連続 | 同じ種類の場面が連続する最大数 | `scenes.max_consecutive_same_kind` |
| 汎用比率 | `generic_kinds`（stat_cards、question）の割合 | `authenticity.max_generic_ratio` |
| 検証済みの根拠 | すべての場面が `scene_claim_statuses` の主張だけを参照する | `authenticity.scene_claim_statuses` |
| 独立した仕事 | `verification_roles` の順序（auditor→resolution）が台本にあり、`comparison_kinds` の場面数が図表の数 × `scenes_per_figure` 以上 | `authenticity.independent_work` |
| 出典の表示 | すべての主張の出典名が、その主張を扱う台本区間の出典欄に出る | 台本の出典欄（検査は FeatureSpec の sources と segments） |
| 他社素材 | 場面に URL を含めない（他社の画像・図の取り込みを禁止） | 構造上の検査 |
| 過去の公開との類似 | 直近 `history_window` 本の公開済み run と、台本の visualType 列の類似度（1 - 編集距離 / 長い方の長さ）が上限以下 | `authenticity.history_window`、`authenticity.max_similarity` |

閾値はすべて `config/domains/byosan_money.yaml` に置き、コードに値を埋め込まない。閾値を通すために緩めることは、監査の趣旨に反するため行わない。
