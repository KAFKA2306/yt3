# ADR-0015: マルチチャンネル YouTube 投稿の分離管理

この文書は `docs/adr/0010-yawa-archive-asmr-publish-workflow.md` に統合済みのため、履歴として archive に退避する。

## Status

Accepted

## Context

`秒算マネー` と `夜話アーカイブ ASMR` は同じ Google アカウント配下であっても、Brand Account の違いにより別チャンネルとして運用される。

このため、`token.json` や `refresh_token` が存在するだけでは、正しいチャンネルに紐づいている保証にならない。

投稿事故を防ぐには、認証情報を残しつつ、チャンネルごとに profile を分離して扱う必要がある。

## Decision

YouTube 投稿は、以下の分離ルールで運用する。

1. チャンネルごとに profile を分ける
   - `config/.env.byosan` は `秒算マネー` 用
   - `config/.env.yawa` は `夜話アーカイブ ASMR` 用
2. OAuth の channel 照合を必須にする
   - 投稿前に `channels.list({ mine: true })` を実行する
   - `snippet.title` と `channelId` を profile の期待値と照合する
   - 不一致なら投稿を中止する
3. 投稿時の既定値を固定する
   - `privacyStatus: "private"`
   - `selfDeclaredMadeForKids: false`
4. public 化は明示操作に限定する
   - 自動で `public` に戻す処理は profile なしでは動かさない
   - `default .env` では投稿できない
5. 実行経路を profile 前提にする
   - `publish` は `ENV_FILE` がない場合に失敗する
   - `publish:byosan` と `publish:yawa` を明示的な実行入口にする

## Consequences

- `token.json` が残っていても、誤ったチャンネルへの投稿を止められる。
- 秒算マネーの資格情報を保持したまま、夜話アーカイブ ASMR の OAuth を追加できる。
- 投稿前に channel 名を検証するため、勘違いとコンタミを抑えられる。
- 代わりに、初回設定時は profile ごとの env 作成と OAuth 再認証が必須になる。
