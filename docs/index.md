---
okf_version: "0.3"
title: "YT3 Knowledge Base"
description: "YT3 の3チャンネル（秒算マネー・夜話アーカイブ・雨晴はうの人類観測所）の Mission、制作方針、データ台帳、dbt 分析スキーマを管理する OKF v0.3 知識バンドル。"
---

# YT3 Knowledge Base

Obsidian Vault および OKF v0.3 準拠の知識正本目次。各チャンネルの編集方針、キャラクター・世界観の正本、データ台帳、dbt 分析モデル（`analytics/`）へたどれます。

## チャンネル Mission・制作方針

- [秒算マネー Mission](byosan/MISSION.md) - 世界の企業・AI・マクロ経済の「数字の裏にある構造」を一次資料と歴史比較で届ける2レーン方針と収益化 KPI。
- [夜話アーカイブ ASMR Mission](yawa/MISSION.md) - 固定キャスト3名と全年齢・広告適合ラインで推しと登録を育てるシチュエーションボイス劇場の制作方針。
- [夜話アーカイブ 声の嗜好と演技基準](yawa/voice-preferences.md) - 固定キャスト運用における聴き心地・演技の基準と息音演出の制約。
- [夜話アーカイブ 制作方針の振り返り](yawa/production-retrospective.md) - 旧設計で表現が狭まった要因と現行方針へ切り替えた経緯の記録。
- [雨晴はうの人類観測所 Mission](humanity/MISSION.md) - 「晴れ待ち坂」物語音楽レーベルの編集目的、曲名・ジャケット・週3本頻度・収益化 KPI。
- [雨晴はうの人類観測所 SOUL](humanity/SOUL.md) - 雨晴はうの人格・温度・音の手触り・倫理の核。
- [人類観測所の作詞と物語づくり](humanity/songwriting.md) - 晴れ待ち坂の共有世界・短い曲名・概要欄・JIZURA 文字PV・ジャケット制作の手順。

## データ設計・運用基準

- [Repository Record Index（台帳正本）](standard/ledger-standard.md) - 実行記録・状態・分析テーブル・マスタの所在、粒度、スキーマ所有者の一覧。
- [Star Schema & dbt Standard](standard/star-schema-standard.md) - `db/evolution.db` から `analytics/` dbt プロジェクトへ至る Raw → Staging → Marts 設計、粒度、KPI 定義、検証手順。
- [YT3 Channel Benchmark Standard](standard/benchmark-standard.md) - 3チャンネルの3層評価（機械照合・独立ブラインド採点・dbt実績）と合格条件・反例・コマンドの正本。
- [YT3 Resident Agent Standard](standard/resident-agent-standard.md) - 作業台帳・質問台帳・単一書き込みロック・冪等再開・systemd 常駐の運用正本。
- [Owner Action Ledger（ユーザ操作必須台帳）](standard/owner-action-ledger.md) - エージェント権限外のためユーザ本人の操作・判断・認証が必須な項目を一元管理する台帳。
- [YT3 Model Routing & GPU Conservation Standard](standard/model-routing-standard.md) - 追加料金ゼロの既存サブスク CLI と RTX 3060 12GB の排他・単発運用を定めるモデル配分正本。
- [YT3 Quality Gates](QUALITY_GATES.md) - リポジトリ受入（`check:merge`）・プロダクト準備・外部公開検証の境界とツール所有権。
- [Environment Refresh Standard](standard/environment-refresh.md) - 開発環境を1時間ごとに測定・更新・ロールバックする自律ループの規約と台帳。

## 廃止・後継案内（Deprecated）

- [旧 Humanity Observatory 編集監査基準書](standard/humanity-observatory-audit-standard.md) - 廃止済み。現行方針は [雨晴はうの人類観測所 Mission](humanity/MISSION.md) と [SOUL](humanity/SOUL.md) を参照。
