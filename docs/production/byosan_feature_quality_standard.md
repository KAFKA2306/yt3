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
- つかみ: タイトルとサムネの主要数値を冒頭30秒以内に回収する。
- 内容: 全ての重要主張が一次資料に紐づき、概算と公式開示を明確に分ける。
- イントネーション: 章の役割に応じて7種類以上の感情プリセットを使う。
- 字幕: 1キュー最大2行、可読サイズ、1キュー0.84秒以上を目安にする。
- 動き: 各発話で画面更新し、4秒以上の静止判定を出さない。周期的な左右・上下パンは禁止し、中心固定ズームまたは要素更新を使う。
- 感情表現: 驚き、疑問、核心、注意、納得、結論が台本と音声と画面で一致する。
- ジェスチャー: キャラクターの指差し、ポインター、数値カードの対象を一致させる。
- サムネ: 文字を小画面で読め、動画冒頭が約束をすぐ回収する。

## 継続改善層: agent improvement loop / harness design

失敗は `audit/production_quality_report.json` に要件別で残す。再制作時は、失敗した要件を台本、音声プリセット、字幕分割、映像レンダリング、公開ゲートの実装変更へ変換する。公開結果と視聴維持率が得られたら、冒頭30秒の離脱、トップモーメント、サムネとタイトルの整合を次の eval に追加する。

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
| 動き | YouTubeの維持率ガイドは後半のTop momentsを前へ移す改善を推奨。視認性を損なう周期的な揺れはプロジェクト判断で禁止 | 1発話1シーン、中心固定の緩いズーム、左右・上下振動なし、4秒静止検出ゼロを要求 |
| 感情 | motivational prosody研究とVOICEVOX制御項目を、感情を音声へ変換する根拠にする | 驚き→疑問→核心→注意→納得→確信→余韻のアークを台本・音声・画面ラベルで同期 |
| ジェスチャー | 指差し位置と発話対象の不一致は理解負荷を増やし、通常の人差し指は強い注意誘導になるという実験結果を採用 | 指差しキャラクター、ポインター線、数値カードの対象を同じ側へ固定し、話者交代時だけキャラクターを切替 |
| サムネ | YouTubeは正確・簡潔なタイトル、可読文字、複雑にしすぎない構図、カスタムサムネを推奨 | 構造化specの主要数値を大階層で表示し、冒頭で回収。API用JPEG、反映attestationを別生成 |

## 日次経路

- カノニカルな入口は `task byosan:daily`。
- `--dry-run` はスキーマ、基準spec、公開抑止を検証する。
- ニュース候補は5件以上、発行主体3つ以上、直近30日との最大類似度0.42以下を要求する。
- `LangChain.withStructuredOutput` とZodで企画・制作specを検証し、決定的ゲートを通らない出力は最大3回まで検証エラー付きで再生成する。
- 同日のupload receiptを検出した場合は再アップロードしない。公開完了にはreceipt、public visibility、thumbnail attestationを必要とする。
