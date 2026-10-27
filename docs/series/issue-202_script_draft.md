# Issue #202 video script draft v2 — Goals → Signals → Metrics

Status: original comedy-sketch draft with a refreshed, source-backed yt3 example. This is not production-ready: voice/audio assets and the destination channel profile remain unresolved. Canonical compile currently fails because docs/series/audio/pending-channel-and-voice/hook-scene.wav is absent. No render, QA release gate, or publication has passed.

## New-work card — 2026-10-16 JST

- **Topic:** Turn a desired outcome into an observable signal and a decision-useful metric.
- **Viewpoint:** The fictional lunar-base inventory clerk, whose report looks excellent while the crew is still missing equipment.
- **Situation:** Five minutes before an EVA, one work glove is passed between two crew members and repeatedly scanned as “returned.”
- **Humor mechanism:** A countable proxy is optimized instead of the outcome; transaction volume loops upward while the intended handoff never happens.
- **Payoff:** The clerk reports record returns, but the glove is still at the desk. “The goal is to send the crew outside, not the chart.”
- **Comparison:** Compared with the existing Issue #202 explainer draft and docs/archive/proposals/planning/issue-201.md through issue-208.md. Those planning docs cover GSM foundations, SLOs, monitoring, SRE loops, architecture, and measurement; this draft uses a lunar lost-and-found setting and a proxy-metric handoff loop. The repository currently contains no other finished series scripts or accessible production videos for a full-corpus comparison. Novelty is provisional; no claim is made about all public videos.
- **Comedy QA (editorial draft):** Setup = missing glove before EVA; escalation = same glove scanned through repeated handoffs; reversal = the “best” return count leaves the glove at the desk; payoff = the chart is ready to go to the moon instead of the crew. Multiple beats are present, but read-aloud timing and independent review remain pending.

## Script and visual beats (target ~90 seconds)

### 0:00–0:12 — Hook

**Visual:** Fiction label; lunar-base inventory counter; EVA timer at five minutes.

**Dialogue:**

> 隊長「右手の作業グローブがない！」 係「朗報です。返却スキャン数、今週最高です」 隊長「手袋は？」

### 0:12–0:28 — Goal and Signal

**Visual:** Goal card, then recipient → equipment check → airlock.

**Narration:**

> Goalは、出発までに正しい持ち主が使える状態の道具を受け取ること。Signalは、その人が品物と状態を確かめ、装着してエアロックへ向かったか。

### 0:28–0:48 — The wrong metric escalates

**Visual:** The same glove circles A → B → A four times; the return-scan counter visibly rises from 1 to 8 while “recipient equipped” stays blank.

**Dialogue:**

> 係「Metricは？」 ナレーター「Signalを測る不完全な代理値。初回の正しい受け渡し率と待ち時間、などです」 係「でも一番数えやすいのは返却スキャン！」
>
> ナレーター「同じ手袋をAからBへ、BからAへ4往復。返却スキャンは8回です」
>
> 係「八回返却！先週の八倍です」

### 0:48–1:02 — Reversal / payoff

**Visual:** The crew’s hands are empty; the glove remains at the desk.

**Dialogue:**

> 隊長「持ち主に届いた？」 係「窓口にあります。記録上は返却完了です」
>
> ナレーター「返却回数は増えてもGoalは未達。数字だけが月面を歩きます」

### 1:02–1:22 — Ground it in the repository

**Visual:** Show the actual Goal → Signal → Metric map, with the UTC window and units attached.

**Narration:**

> yt3のGoalは、安全チェックを弱めず、解釈できるCI結果を早く受け取ること。9月27日から10月27日までの30日で、初回CIは227件。217件成功、10件失敗。成功率95.6%、p95は173秒です。
>
> これはPR数ではなくworkflow run数。同じPRから複数runがあり得ます。生産性やコード品質そのものではなく、遅い工程や失敗ログを調べるための代理値です。

### 1:22–1:30 — Close

**Dialogue:**

> 隊長「目標は隊員が月へ出ること。グラフを外に出すな！」
>
> GoalからSignal、Metricへ。数字は次の判断につながって初めて役に立ちます。

## Evidence and interpretation

- Snapshot: config/metrics/snapshots/issue_202_ci_30d_20261027_121007.json.
- Source: [GitHub REST API — workflow runs](https://docs.github.com/en/rest/actions/workflow-runs), workflow 226201883, event pull_request, completed first attempts, recorded UTC window.
- Formula: nearest-rank p95 of updated_at - created_at; success rate is 217 / 227 = 95.6%. The median for this odd-sized sample is 127 seconds. The denominator is completed first-attempt workflow runs, not distinct PRs. Queue/service delay can be included. This does not establish causal effects or directly measure productivity or code quality.
- Framework rights basis (checked 2026-10-20 JST): the official LinkedIn DPH landing page https://linkedin.github.io/dph-framework/ identifies the framework as CC BY 4.0 and © 2023 LinkedIn Corporation. The official CC BY 4.0 deed https://creativecommons.org/licenses/by/4.0/ permits sharing and adaptation subject to appropriate credit, a license link, an indication of changes, and no suggestion of endorsement. Proposed description attribution: “Source: LinkedIn Developer Productivity & Happiness Framework, ‘Goals, Signals, and Metrics’ (LinkedIn Corporation, © 2023); https://linkedin.github.io/dph-framework/goals-signals-metrics.html; licensed under CC BY 4.0 https://creativecommons.org/licenses/by/4.0/. Japanese summary/adaptation by YT3; changes made; not endorsed by LinkedIn.” This documents the framework-text basis only; it does not clear voice, audio, visual, trademark, privacy, publicity, or other third-party rights, and is not a complete legal clearance.
- The moon-base scene is fiction, not a claim about a real mission. Issue #202 references Software Engineering at Google; its online-edition notice was not used as source text in this script.

## Release blockers and next step

- The latest canonical compile was run on 2026-10-19 JST and failed at ffprobe because docs/series/audio/pending-channel-and-voice/hook-scene.wav is absent; no compiled output was created.
- No channel/profile is mapped to this series; the byosan profile is a separate product and must not be inferred as the destination.
- Voice and rights-cleared narration/audio are pending. Do not synthesize a substitute voice or skip the media checks.
- Next: confirm destination profile and voice, prepare rights-cleared audio, then compile, render, conduct read-aloud/content QA, pass the canonical release gate, and only then use the authorized publish/read-back path.
- No upload was attempted. Actual YouTube visibility for Issue #202 remains UNVERIFIED; absence of a local receipt is not proof of non-publication.
