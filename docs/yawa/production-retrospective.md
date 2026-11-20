---
type: "reference"
title: "夜話アーカイブ 制作方針の振り返り"
description: "旧設計で表現が狭まった要因と現行の固定キャスト方針へ切り替えた経緯の記録。"
tags:
  - yt3/yawa
  - yt3/retrospective
aliases:
  - "yawa-retrospective"
generated:
  by: "antigravity/gemini-4-neon-high"
  at: "2026-11-20T00:25:00Z"
---

# Yawa 制作方針の振り返り

この記録は以前の制作設計で表現が狭まった理由を残すものです。現行の制作方針の正本は [夜話アーカイブ Mission](MISSION.md) と [characters.json](characters.json)、実行設定は `config/yawa/daily.yaml` を参照してください。

## 前の設計で起きていたこと

- 場所や小道具の組み合わせは多くても、夜の静かなケア場面に集まっていた。
- 声のプロフィールは形容詞を替えても、近く、穏やかで、語尾を抑える共通指示を繰り返していた。
- 数値測定や固定台詞は、聴き手が感じる声の魅力や作品の面白さを直接示せなかった。
- 毎回ランダムに声を作り直す運用では、リスナーが「この声・キャラが好きだから登録する」という推し軸が育ちにくく、また「終電を逃した夜＋弱音ケア」への収束が再発していた。

組み合わせ数や測定値を増やしても、作品の実際の幅や登録継続率には直結しない。固定キャスト3名制・ジャンルローテーション・キャラ一貫サムネイル・実視聴データ還流へ切り替えた。

## 最近の聴取結果

2026-11-17、オーナーは直近の作品について、以前より声質とストーリーが良くなったと報告した。2026-11-16 の制作では人物ごとの参照音声を各台詞に使った。人物ごとの参照音声による一貫性の知見を、現行の固定キャスト永続参照音声（`data/state/yawa/references/<character_id>.wav`）へ発展させた。

市場調査の過去の参照先: [ASMR Den のタグ一覧](https://asmrden.com/tags)、[DLsite ASMR Award 2020](https://media.eisys.co.jp/public/uploads/20210128_asmrawrds_press.pdf)、[DLsite Award 2021](https://media.eisys.co.jp/public/uploads/20220210_DLsite_press.pdf)。これらは企画の参考資料であり、販売数や夜話アーカイブの聴き手の好みを示すものではありません。
