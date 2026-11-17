# 暴落のあと、なぜすぐ戻る市場と戻らない市場があるのか？

[Issue #538](https://github.com/KAFKA2306/yt3/issues/538) の収録原稿。ずんだもんと春日部つむぎの掛け合いで、約9分を想定。

- [収録原稿](../../config/productions/historical_market_crashes.json) の `segments[].text` が読み上げ台詞。画面の見出しと数字、タイトル、サムネイル文言、説明欄も指定済み。
- [ファクトシート](../../config/byosan/fact_sheets/historical_market_crashes.json) に出典、観測期間、計算条件を収録。月まで公表された資料は日付欄で月初にそろえた。FREDの日付は参照日。
- 1987年の終値、2010年の日中変化、2022年の英国債利回り、世界恐慌期の複数年下落を比較する。急騰後も上がったベルギーと、直前の3暦年に倍増していなかった2020年の米国株を対照例に使う。

## この原稿で制作する

制作ホストのリポジトリ直下で、制作日 `DATE` を明示して実行する。原稿とファクトシートを既存検査にかけ、新規runの再開用データとして保存する。そのrunを通常の制作コマンドで準備する。

```bash
: "${DATE:?Set DATE to the requested YYYY-MM-DD}"
export DATE
export BYOSAN_SUFFIX=-historical-market-crashes

bun - <<'TS'
import path from "node:path";
import fs from "fs-extra";
import { buildFeatureSpecInput, featureDraftIssues, prepareFeatureDraftInput } from "./src/domain/byosan/feature_draft";
import { ByosanFeatureDraftSchema, parseAndAuditByosanFeatureSpec } from "./src/domain/byosan/feature_spec";
import { factSheetArticles, loadFactSheet, writeFactSheetResearch } from "./src/domain/byosan/fact_sheet";
import { reconcileByosanCheckpoint, writeByosanCheckpoint } from "./src/domain/byosan/checkpoint";
import { loadPublishedByosanSourceUrls } from "./src/domain/byosan/published_sources";
import { loadConfig } from "./src/io/core";

const asOf = process.env.DATE;
const endOfDay = new Date(asOf + "T23:59:59Z");
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? "") ||
    Number.isNaN(endOfDay.getTime()) || endOfDay.toISOString().slice(0, 10) !== asOf) {
  throw new Error("DATE must be a calendar date in YYYY-MM-DD form");
}
const runId = "byosan_money/" + asOf + "-daily" + process.env.BYOSAN_SUFFIX;
const root = process.cwd();
const config = loadConfig("byosan_money");
const runDir = path.join(root, config.workflow.paths.runs_dir, runId);
if (fs.existsSync(runDir)) throw new Error("Run already exists: " + runId);

const sheet = loadFactSheet("config/byosan/fact_sheets/historical_market_crashes.json");
const raw = fs.readJsonSync("config/productions/historical_market_crashes.json");
const input = prepareFeatureDraftInput({
  runId, asOf, today: factSheetArticles(sheet.sheet), baseline: [],
  publishedUrls: loadPublishedByosanSourceUrls(root, endOfDay, config.discovery.repeat_window_days),
});
const issues = featureDraftIssues(raw, input);
if (issues.length) throw new Error(JSON.stringify(issues));
const draft = ByosanFeatureDraftSchema.parse(raw);
const spec = parseAndAuditByosanFeatureSpec(buildFeatureSpecInput(draft, input));
fs.ensureDirSync(path.dirname(runDir));
fs.mkdirSync(runDir);
writeFactSheetResearch(sheet, runDir);
fs.outputJsonSync(path.join(runDir, "source", "feature_spec.json"), spec, { spaces: 2 });
fs.outputJsonSync(path.join(runDir, "source", "explanation.json"), draft.explanation, { spaces: 2 });
const checkpoint = reconcileByosanCheckpoint(runDir, runId, root);
checkpoint.stages.research_ready = true;
checkpoint.stages.spec_ready = true;
writeByosanCheckpoint(runDir, checkpoint);
console.log("Script staged: " + runId);
TS
```

`Script staged` が表示されたら、同じシェルで実行する。準備中に失敗して再開する場合も、まず既存runの状態を確認し、このコマンドを使う。

```bash
task byosan:prepare DATE="$DATE" FACT_SHEET=config/byosan/fact_sheets/historical_market_crashes.json
```
