# YT3 — Auditable Autonomous Media Operations

**動画を自動生成できることより、間違った事実・間違ったチャンネル・未監査の動画を自動公開しないことの方が難しい。**

YT3 は、調査・台本・音声/映像制作・監査・YouTube公開を自動化しながら、**どの事実を使い、どのchannelへ出し、何を検証して公開を許可したかを追跡できるmedia production system**です。

実行の正準入口は `Taskfile.yml` です。

```bash
task --list
```

## Vision

AI media productionを「大量に動画を作る仕組み」から、**人間が安心して制作を任せられ、公開後も事実・routing・receiptを監査できる運用**へ変えます。

動画が完成したように見えても、次が揃わなければ公開成功とは扱いません。

- factual claimのprovenance
- research / scripting / productionの責務分離
- brand / channel identityの一致
- audio / visual / narrative audit
- publish receipt
- public visibility verification

## Design philosophy

- **Facts first. Structure later.** 抽象論から始めず、具体的event・人物・企業・数値・差分から物語を組む。
- **Every claim has provenance.** VERIFIED / OBSERVED / INFERRED / UNVERIFIEDを区別し、FABRICATED claimを許可しない。
- **Research is not production.** research → script → productionへ渡すのはvalidated factだけ。
- **Fail closed.** verifier crash、timeout、routing mismatch、evidence不足をfallbackで隠してpublishしない。
- **Channel identity is a security boundary.** 秒算マネー / 夜話アーカイブ / 人類観測所を絶対に混ぜない。
- **One executable front door.** 実運用はTaskfileから起動し、entry pointを増殖させない。
- **Artifact success is not publication success.** video file生成とYouTube公開receipt / visibilityを別stateとして扱う。
- **Human relevance over AI-sounding prose.** fact → meaning → human consequenceの順で視聴者が数秒で「なぜ見るか」を理解できるようにする。

## Why / 差別化

一般的なAI動画pipelineは、LLM・TTS・画像生成・編集をつなげることが中心になりがちです。YT3の差別化はtool数ではなく、**自律制作を公開責任まで含む検証可能なworkflowとして扱うこと**です。

具体的には、

- claim provenanceを分類する
- brand/channel routingを機械検証する
- audit failureをpublish blockerにする
- publish receiptを残す
- 公開後visibilityを別auditする
- failed runも改善loopの入力として残す

ことで、「生成できた」から「正しい宛先へ、監査済みの内容を公開した」までを一つのoperationとして扱います。

## Three channel identities

3系統は明示的に分離します。

| profile | brand | bucket | canonical task |
|---|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` | `task byosan:daily` / `task publish:byosan` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` | `task publish:yawa` / `task asmr:publish` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` | `task run:humanity` / `task publish:humanity` |

`publish` はprofile指定を必須にします。

```bash
task publish PROFILE=byosan
task publish PROFILE=yawa
task publish PROFILE=humanity
```

unknown profileはfailします。

## Production flow

```text
source / event
  → research
  → verified facts
  → script
  → audio / visual production
  → deterministic + editorial audit
  → channel routing audit
  → publish
  → publish receipt
  → public visibility audit
  → evolution / improvement evidence
```

各phaseを跨ぐときに、前段の未検証assumptionを「事実」として継承しません。

## Claim provenance

agentが扱うclaimは `GEMINI.md` のruntime contractに従います。

- `VERIFIED` — tool executionで直接確認
- `OBSERVED` — user input / explicit ruleとして与えられた
- `INFERRED` — 観測から導いた仮説。推論として表示
- `UNVERIFIED` — 未確認
- `FABRICATED` — forbidden

「それらしい説明」をaudit evidenceの代替にしません。

## Operational entry points

### Daily / production

```bash
task loop
task run
task run:humanity
task byosan:daily
task pulse:auto
```

### Publish

```bash
task publish PROFILE=byosan
task publish:nlm
task asmr:publish
```

`publish:nlm` と `asmr:publish` は既存成果物を公開する正規入口として維持します。

### Audit

```bash
task audit:today
task audit:publish-routing
task audit:byosan-money
task audit:no-fallback
task audit:ontology
task publish:visibility-audit
task movie:status
```

### System health

```bash
task harness:doctor
task harness:doctor:quick
task daily:guarantee-status
task daily:report
task improve:report
```

### Quality

```bash
task lint
task test
```

## Publication contract

YouTube API callが成功しただけでは完了ではありません。

公開成功として扱うには、少なくとも次の境界を通します。

1. content artifact exists
2. content audit passes
3. intended profile / bucket is explicit
4. authenticated channel identity matches intent
5. publish receipt (`videoId`, `channelId`) exists
6. public visibility audit confirms expected state

routing mismatchやverifier failure時はpublishを止めます。

## Narrative contract

視聴体験の基本順序:

```text
Concrete event
  → Why this matters
  → Human consequence
  → Broader implication
  → Optional structural insight
```

抽象的な「時代が変わる」「見えない構造」から始めません。

視聴者が早い段階で理解すべきもの:

- who
- what
- why now
- why it matters

macro eventは必要に応じて生活・お金・仕事・不安・機会などのhuman relevanceへ接続します。

## Audit model

media artifactには、可能な範囲で決定論的な検証を優先します。

例:

- ASR / spoken content
- loudness
- speaker / voice role identity
- visual style / brand token
- forbidden cross-brand attributes
- publish routing
- receipt / visibility

`evidence_raw.json` 等のraw evidenceを、agentの説明文より上位の証拠として扱います。

## State / evidence

主要な運用artifact:

```text
runs/       production runs and artifacts
audits/     audit evidence
artifacts/  generated/supporting artifacts
db/         evolution / audit trace database
docs/       ADR / standards / audit protocols
src/        production logic and agents
asmr/       ASMR-specific workflow assets
```

詳細な監査protocol: [docs/AUDIT_PROTOCOL.md](docs/AUDIT_PROTOCOL.md)

Humanity Observatory editorial standard: [docs/standard/humanity-observatory-audit-standard.md](docs/standard/humanity-observatory-audit-standard.md)

## Runtime contract

`GEMINI.md` がautonomous agentのstrict operational boundaryです。

主な不変条件:

- Zero-Fat implementation
- Crash-Driven Development
- no hidden fallback
- explicit domain naming
- no silent default config inheritance
- multi-modal brand integrity
- provenance classification
- fail-closed audit

READMEよりruntime contractが具体的なagent restrictionを持つ場合、`GEMINI.md` / `AGENTS.md` と現行codeを優先して確認します。

## Local services

```bash
task bootstrap
task up
task down
```

`task up` は現行Taskfile上でVOICEVOX Nemo containerと関連user servicesを起動します。環境依存のため、起動成功をREADMEだけから保証しません。

## Repository map

```text
src/          production / audit / publish logic
config/       channel / environment / domain configuration
runs/         immutable-ish run evidence
audits/       verification evidence
artifacts/    generated supporting artifacts
db/           evolution database
docs/         ADR / standards / protocols
asmr/         ASMR workflow
Taskfile.yml  canonical executable entry point
GEMINI.md     autonomous runtime contract
AGENTS.md     agent working rules
```

## Completion boundary

次を混同しません。

```text
SCRIPT_DONE
MEDIA_GENERATED
AUDIT_PASSED
ROUTING_VERIFIED
PUBLISHED
VISIBILITY_VERIFIED
```

後段の証拠がなければ、そのstateより先へ進んだとは表現しません。

## Done

YT3の成功指標は動画本数やagent数ではありません。

**調査から公開後確認までを自動化しても、人間が「どの事実を使ったか、なぜこのchannelへ出したか、どのauditを通ったか、実際に公開されたか」を後から説明できること**をDoneの中心に置きます。
