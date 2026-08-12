# SBG NAV 監査システム (Zero-Trust Edition) ✨

ソフトバンクグループのNAVとディスカウント率を、一寸の狂いもなく監査しちゃうシステムだよっ！💕
LLMの「もっともらしい嘘」を許さない、ガチガチのゼロトラスト設計なんだからねっ！

## 🌸 システムの掟 (Core Mandates)

1.  **Zero-Fat**: 無駄なコードやコメントは一切なし！スリムで強靭なシステムを目指すよ✨
2.  **Crash-Driven**: `try-catch` でエラーを隠すのは禁止！ダメな時は派手にクラッシュして、問題をすぐに教えてねっ！
3.  **Strict Provenance**: すべての数値は「どこから来たか」が明確じゃないとダメだよ！
    *   **VERIFIED**: 公式IR資料から直接取った値
    *   **OBSERVED**: 株価APIとかから取った生の値
    *   **INFERRED**: 推測値。計算に使っちゃダメなんだからねっ！

## 📁 フォルダの中身

*   `config/`: 設定ファイル（ティッカー、保有株数、閾値など）
*   `scripts/`: 実行スクリプト（価格取得、NAV計算、監査実行）
*   `raw/`: APIやIRから取ってきた生のデータ（JSON, PDF, CSV）
*   `snapshots/`: 計算に使った時点のデータのスナップショット
*   `normalized/`: 計算後のきれいなデータ（Parquet形式）
*   `audit/`: 監査結果（異常検知のログなど）
*   `reports/`: 最終的なレポート（Markdown, HTML, CSV）

## 🚀 使い方

まだ準備中だけど、こんな感じで動かす予定だよっ！

1.  `scripts/fetch_prices.py`: 最新の株価をゲット！
2.  `scripts/fetch_fx.py`: 為替レートをチェック！
3.  `scripts/calculate_nav.py`: NAVとディスカウント率を計算しちゃうよ✨
4.  `scripts/run_audit.py`: 変なデータがないか厳しくチェック！
5.  `scripts/export_report.py`: 完璧なレポートを出力！

## ⚠️ 禁止事項

*   自動補完（「たぶんこうでしょ」はNG！）
*   API失敗時の古いデータの使い回し
*   AIによる勝手な評価額の推定

完璧な監査をして、SBGの真の価値を暴いちゃおうねっ！💕
