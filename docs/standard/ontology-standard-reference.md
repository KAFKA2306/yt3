# Ontology Standard Reference

## 目的
このメモは、yt3 プロジェクトで「オントロジー」を参照するときの国際標準の当たり所を整理したもの。

## 標準定義
- `ontology` は、ISO 系の公開参照では `formal, explicit specification of a shared conceptualization` と定義される。
- 日本語では「共有された概念化を、形式的かつ明示的に仕様化したもの」と解釈できる。

## プロジェクトでの採用候補
### 1. ISO/IEC 21838-1:2021
- Top-level ontology (TLO) の要求事項を定める国際標準。
- ドメイン ontology と組み合わせて、データ交換・検索・統合・分析を支える前提の標準。
- このプロジェクトで「上位の枠組み」を定義したい場合、まずここを参照する。

### 2. ISO/IEC 21838 系の代表例
- `ISO/IEC 21838-2:2021` BFO
- `ISO/IEC 21838-3:2023` DOLCE
- `ISO/IEC 21838-4:2023` TUpper
- `ISO/IEC DIS 21838-5` UFO, 2026-06-19 時点では開発中

## 実務上の読み方
- 「定義そのもの」を押さえるなら ISO 5127 / ISO/IEC TR 20943-6 系。
- 「設計の骨格」を押さえるなら ISO/IEC 21838-1 系。
- 実装や知識表現の詳細は、別途 OWL / CL などの各種言語仕様を確認する。

## 参照
- https://www.iso.org/obp/ui/es/  (ISO 5127:2017 の ontology 定義スニペット)
- https://www.iso.org/obp/ui/en/  (ISO/IEC TR 20943-6:2013 の ontology 定義スニペット)
- https://www.iso.org/standard/71954.html
- https://www.iso.org/standard/74572.html
- https://www.iso.org/standard/78927.html
- https://www.iso.org/standard/78928.html
- https://www.iso.org/standard/89915.html
