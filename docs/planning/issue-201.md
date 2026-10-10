# Issue #201: Series #01 なぜソフトウェア開発を数字で測るのか

Parent: #200

## 1. 問い

メトリクスを増やす前に、何を目的として測るべきか。

## 2. 原典

- 出典: Software Engineering at Google (abseil.io 公開版)
- URL: https://abseil.io/resources/swe-book/html/toc.html
- 該当章: 「Measuring Engineering Productivity」（節: Why Should We Measure Engineering Productivity? / Triage: Is It Even Worth Measuring? / Selecting Meaningful Metrics with Goals and Signals / Metrics / Using Data to Validate Metrics）
- 確認状況: 目次ページで章と節の存在を確認済み（取得日 2026-10-10）。本文の各主張は本文未取得のため UNVERIFIED

## 3. 脚本の骨子（単独視聴で成立する構成）

1. 導入: 「数字があるから安心」という感覚への問いかけ
2. 測定は目的ではない。何の判断を助けるかを先に決める
3. 目的を 速さ / 品質 / 安定性 / 保守性 に分解する
4. 悪い指標が行動を歪める例（例: 行数や commit 数を生産性とみなすと、細分化や無意味な変更が増える）
5. 自分の repo で最初に測る対象を 1 つ決め、目的と結びつける
6. まとめと、次回 #02 への導線

## 4. 成果物チェックリスト

| 工程 | 成果物 | 状態 |
|---|---|---|
| Research / Evidence | 一次ソースの根拠（上記 URL と章名） | 目次確認済み。本文は UNVERIFIED |
| episode.json | 章立て・要点・根拠の構造化データ | 未作成 |
| Script | 日本語ナレーション原稿 | 未作成 |
| Storyboard | シーン割りと画面要素 | 未作成 |
| Render / QA / publish gate | 動画生成と品質確認 | 未実施。公開は別途明示認可が必要 |

## 5. repo 指標への落とし込み

最初に測る対象（案）: 本 repo の pipeline 1 回の実行について、次の 2 指標を先に決める。

- 安定性: 直近 N 回の実行で、失敗または再試行を要したステップの割合
- 速さ: 1 本の成果物（run）が preparation 完了するまでの所要時間

選定理由: どちらも既存の run 成果物（`runs/<run_id>/`）から取得でき、新規計測基盤を要しない。
注意: 指標を決めるだけで、目標値の設定や行動の強制はしない。

判断は後続 issue で行う（未確定）。

## 6. 完了条件の状況

- [x] 一次ソースの根拠を保存（URL と章名を本ファイルに記録。本文引用は UNVERIFIED）
- [x] 1 つ以上の repo 指標へ落とす（安定性・速さの 2 指標を提示）
- [ ] 単独視聴で成立（脚本本文が未作成のため未達）
- [ ] 次回 #02 への導線を入れる（脚本本文が未作成のため未達。導線案: 「では、測った数字をどう判断に使うか」を #02 へつなぐ）

## 7. 未完了項目と理由

- 脚本本文、episode.json、Storyboard は本タスクの対象外（担当範囲は本ファイルのみ）のため未作成
- SWE book 本文の引用確認は、目次以外の取得を行っていないため未実施（UNVERIFIED）
- 指標 2 点の妥当性は repo の run 成果物を読んで確認していないため、取得可否は UNVERIFIED
