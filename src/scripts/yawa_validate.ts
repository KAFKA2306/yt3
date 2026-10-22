import path from "node:path";
import fs from "fs-extra";
import { validateYawaRun } from "../domain/yawa_validation.js";
import { YOUTUBE_PROFILES } from "../domain/youtube_profiles.js";
import { ROOT } from "../io/core.js";

const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
	throw new Error("usage: yawa_validate.ts YYYY-MM-DD");

const runDir = path.join(ROOT, "runs", "yawa_archive", `yawa-${date}`);
if (!fs.existsSync(runDir))
	throw new Error(`yawa run directory is missing: ${runDir}`);

const result = validateYawaRun(
	runDir,
	YOUTUBE_PROFILES.yawa.expectedChannelTitle,
);
console.log(JSON.stringify(result));
if (result.status !== "PASS") process.exit(1);
