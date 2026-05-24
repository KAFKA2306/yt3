# ADR 0038: 投稿先取り違え防止の宛先ガード

## ステータス
Accepted

## コンテキスト
yt3 では投稿先ごとに実行領域が分かれており、宛先を間違えると公開事故になる。

必要なのは、`profile.id`、`profile.bucket`、`profile.expectedChannelId` を exact match で照合する決定論的な経路制御である。

`title` と `handle` は観測情報として残すが、最終ゲートには使わない。`channelId` だけを hard gate とし、それ以外では publish を許可しない。

## 対応表

| bucket | profile.id | channelId 主キー | 表示名 | handle |
| :--- | :--- | :--- | :--- | :--- |
| `daily_pulse` | `byosan` | `UCYtjO-PYBfdG3MuPLXfhA-Q` | 秒算マネー | `@byosan-money` |
| `yawa_archive` | `yawa` | `UCtq3BVv6SBCFjtPiDoetizw` | 夜話アーカイブ ASMR | `@yawa_archive` |
| `humanity_observatory` | `humanity` | `UCMDrWHL4Jc6gtmfoqaW7sxg` | 人類観測所 | `@humanity_observatory` |

profile 名は exact key のみを受け付ける。互換名や自然言語の「系」は使わない。

## 意思決定

### 1. ルーティングは exact match だけを受け付ける
- `profile.id` は registry の exact key とする。
- `bucket` は exact key として扱う。
- prefix rule、部分一致、`byosan 系` のような自然言語分類は policy から排除する。

### 2. チャンネル照合は channelId を最終ゲートにする
- `src/domain/youtube_profiles.ts` は profile registry に `expectedChannelTitle`、`expectedChannelHandle`、`expectedChannelId` を固定定義する。
- `src/domain/agents/publish.ts` は `state.bucket` と `profile.bucket` を照合し、その後で `channelId` の一致を確認する。
- `title` と `handle` は観測ログとして残すが、これらの一致だけでは publish を許可しない。

### 3. 未解決は必ず fail closed
- `profile.bucket` が解決できない場合は publish 禁止。
- `profile.expectedChannelId` が解決できない場合は publish 禁止。
- `ENV_FILE` と `profile.id` の組が未登録、または `Taskfile.yml` の publish entry が profile を明示していない場合も publish 禁止。
- `WARN` 継続や暗黙の fallback は認めない。

### 4. run metadata を不変保存する
- publish 直前に `run_id`、`bucket`、`profile.id`、`profile.bucket`、`profile.expectedChannelId`、`channel_title`、`channel_handle`、`publish_intent` を保存する。
- 既存 run の再投稿でも、このメタデータを再照合してから publish する。

### 5. human confirmation boundary を明示する
- 人手運用では最終 API 呼び出し前に、`bucket`、`profile.id`、`channelId`、`run_id` を画面表示して確認する。
- 自動運用ではこの境界を省略しない。必要なら設定で明示的に無効化する。

## 監査

以下は audit の対象とする。

- `[FAIL] state.bucket と profile.bucket が不一致`
- `[FAIL] profile.expectedChannelId と認証先 channelId が不一致`
- `[FAIL] ENV_FILE と profile.id の組が未登録`
- `[FAIL] Taskfile publish entry が profile を明示していない`
- `[FAIL] custom profile に bucket / expectedChannelId がない`
- `[FAIL] run metadata に bucket / run_id / profile.id / channelId が保存されていない`
- `[WARN] title / handle のみで一致判定している`

`task audit:publish-routing` を用意し、`Taskfile.yml`、`src/domain/youtube_profiles.ts`、`config/.env*.example` の整合を静的に検査する。

## 帰結
- 誤投稿は、`bucket`、`profile.id`、`channelId` の 3 点照合で API 呼び出し前に止められる。
- 名前変更や handle 変更のような観測揺れに引きずられない。
- 代償として、profile 定義と run metadata の管理責任が増える。
- 将来的には `brand lineage audit` を追加し、thumbnail style、voice preset、tag namespace、prompt pack の混線まで検査する。
