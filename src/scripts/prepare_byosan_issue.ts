import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { parseAndAuditByosanFeatureSpec } from "../domain/byosan/feature_spec.js";
import { writeByosanCanonicalAudit } from "./byosan_daily.js";

function main(): void {
	const [runId, rawSpecPath] = process.argv.slice(2);
	if (!runId || !rawSpecPath) {
		throw new Error("Usage: prepare_byosan_issue.ts <run-id> <spec-path>");
	}
	const specPath = path.resolve(rawSpecPath);
	if (!fs.existsSync(specPath)) {
		throw new Error(`Issue feature spec does not exist: ${specPath}`);
	}
	const spec = parseAndAuditByosanFeatureSpec(fs.readJsonSync(specPath));
	if (spec.runId !== runId) {
		throw new Error(
			`Issue feature spec runId '${spec.runId}' does not match requested run '${runId}'`,
		);
	}
	const runDir = path.resolve("runs", runId);
	if (fs.existsSync(runDir)) {
		throw new Error(
			`Issue run already exists; refusing to reuse production artifacts: ${runId}`,
		);
	}
	const result = spawnSync(
		process.execPath,
		["src/scripts/produce_byosan_feature.ts", specPath],
		{
			cwd: process.cwd(),
			env: { ...process.env, YOUTUBE_CHANNEL_PROFILE: "byosan" },
			stdio: "inherit",
		},
	);
	if (result.status !== 0) {
		throw new Error(
			`Issue feature production failed with status ${result.status ?? "signal"}`,
		);
	}
	writeByosanCanonicalAudit(runDir);
	console.log(`ISSUE_PRODUCTION_READY=${runId}`);
}

main();
