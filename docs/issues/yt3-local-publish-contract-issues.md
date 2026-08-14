# yt3 local publish contract: proposed issues

この文書は、ChatGPT から同型の指示と `publish-job.yaml` が再度渡されたときに、local LLM が迷わず同じ closed-loop agent workflow を実行できるようにするための issue 候補である。

責務境界は次のとおり固定する。

```text
ChatGPT / non-local
  research → source/evidence audit → script → script audit PASS

local
  TTS → image generation → captions → composition → render
  → private staging upload → remote read-back audit → public/schedule → receipt
```

## Issue 1: 外部テキスト成果物を必須化する

**目的**

非ローカル側が原稿を厳密に完了したことを、local pipeline が機械判定できるようにする。local 側で原稿を再生成して穴埋めしない。

**提案**

`publish-job.v2` に `text_contract` を追加する。

```yaml
text_contract:
  owner: non_local
  research_artifact: artifacts/research.json
  script_artifact: artifacts/script.json
  script_schema: yt3.script.v1
  audit_artifact: artifacts/script-audit.json
  audit_status: PASS
  source_policy: primary_or_attributed_secondary
```

`audit_status != PASS`、ファイル欠落、schema不一致、source URL欠落、未解決 placeholder があれば `MEDIA` へ進めず停止する。既存 job は v1 compatibility adapter で `mission_file` から生成できるが、v2 では `script_artifact` を正準入力とする。

**受入条件**

- malformed JSON / schema error は再試行上限後に `TEXT_CONTRACT_FAIL` になる
- local の `script-writer` は、v2 job では上書き生成せず検証専用になる
- script fingerprint が job fingerprint に含まれる

## Issue 2: stage ownership と状態遷移をスキーマ化する

**目的**

「調査済み」「原稿完成」「レンダー済み」「投稿済み」をログ文言ではなく状態として判定する。

**提案**

```yaml
stages:
  text:
    owner: non_local
    required: true
    output: artifacts/script.json
  tts: { owner: local, required: true }
  image_generation: { owner: local, required: true }
  captions: { owner: local, required: true }
  composition: { owner: local, required: true }
  render: { owner: local, required: true }
  youtube_publish: { owner: local, required: true }
```

各 stage は `PENDING → RUNNING → PASS | FAIL | BLOCKED` とし、stage ごとに input hashes / output hashes / validator / attempt / timestamps を保存する。後続 stage は先行 stage の `PASS` と immutable output manifest がなければ開始しない。

**受入条件**

- `task run` の成功だけでは次段階の成功とみなさない
- stage manifest から中断位置を再開できる
- `BLOCKED` は人間または新しい外部成果物が必要な場合に限定される

## Issue 3: artifact manifest と provenance chain を統一する

**目的**

TTS、画像、字幕、統合、レンダー、投稿の各成果物が、どの原稿・設定・モデルから生成されたかを追跡する。

**提案**

`artifacts/manifest.json` を次の形にする。

```json
{
  "schema_version": "yt3.artifact-manifest.v1",
  "job_fingerprint": "sha256:...",
  "items": [
    {
      "stage": "render",
      "kind": "video",
      "path": "final.mp4",
      "sha256": "...",
      "input_sha256": ["..."],
      "tool": "ffmpeg",
      "status": "PASS"
    }
  ]
}
```

**受入条件**

- manifest にないファイルを publish input にできない
- 同じ input hash と設定 hash からの再実行は再利用可能
- receipt が最終 manifest hash を必ず参照する

## Issue 4: local media gate を fail-closed 化する

**目的**

音声・画像・字幕・動画の「存在するだけ」を完了扱いにしない。

**提案する必須検査**

- TTS: 全 script line に対応する音声、再生可能、無音/長さ異常なし
- image: 全 scene に対応、許可拡張子、寸法、生成失敗 placeholder なし
- captions: 全 line の timecode が単調増加し、動画尺内、VTT/ASS の変換結果が検証済み
- render: ffprobe 成功、音声トラックあり、映像尺と字幕尺の許容差内
- thumbnail: PNG/JPEG、2 MiB 以下、`thumbnails.set` 後の remote read-back がPASS

いずれかが `FAIL` のままなら upload intent を作成しない。

## Issue 5: publish intent / remote audit / receipt を一つの状態機械にする

**目的**

`videos.insert` の成功を投稿完了と誤認せず、同一 fingerprint の重複 upload を防ぐ。

**提案**

```text
NO_INTENT
  → INTENT_WRITTEN
  → PRIVATE_UPLOADED
  → PROCESSING_SUCCEEDED
  → THUMBNAIL_VERIFIED
  → CAPTIONS_VERIFIED
  → VISIBILITY_VERIFIED
  → RECEIPT_VERIFIED
```

途中でプロセスが落ちた場合は `UNCERTAIN_REMOTE_COMMIT` として停止する。verified receipt がある場合は `videos.insert` を行わず remote re-audit のみ行う。receipt は次を最低限含める。

```yaml
receipt_status: VERIFIED
job_fingerprint: sha256:...
channel_id: UC...
video_id: ...
processing_status: succeeded
thumbnail_verified: true
captions_verified: true
final_visibility: public
artifact_manifest_sha256: sha256:...
remote_audit_at: 2026-08-14T...
```

## Issue 6: publicize gate と profile destination を job scope に限定する

**目的**

誤チャンネル公開と、環境変数の恒久的な public 化を防ぐ。

**受入条件**

- `channels.list(mine=true)` の `channelId` が profile registry と完全一致しない場合は停止
- `target_visibility` が `private` 以外の job だけ job-scoped gate を有効化
- `allow_publicize` と環境変数の不一致は停止
- scheduled は private + `publishAt` を remote read-back して確認
- quota 数値をコードや契約にハードコードしない

## Issue 7: directive parser と eval を追加する

**目的**

毎回の自然言語指示の解釈差を減らし、trace から harness を改善できるようにする。

**提案**

`LOCAL_LLM_PUBLISH_DIRECTIVE.md` は人間向け説明に加えて、local runner が読む機械可読な実行規約を持つ。runner は次を毎回記録する。

- directive hash / job hash / profile / run id
- stage transitions と tool calls
- validator result と failure class
- upload intent / remote audit / receipt の hash
- retry 回数と最終停止理由

最低限の eval ケースは、(a) malformed script、(b) thumbnail permission failure、(c) captions processing pending、(d) upload intent のみ存在、(e) receipt あり、(f) channel ID 不一致、(g) public gate 不一致とする。eval の失敗を prompt の追記だけで済ませず、validator・schema・routing・retry の変更へ変換する。

## 実装順序

1. Issue 1 と 2: non-local script contract と stage state machine
2. Issue 5 と 6: 重複投稿防止、remote read-back、destination guard
3. Issue 3 と 4: media provenance と fail-closed quality gates
4. Issue 7: directive parser、trace、eval、agent improvement loop

現行の `publish-job.v1`、`task run`、既存 agent 構造は維持し、v2 adapter を追加して段階移行する。別 pipeline は作らない。
