import path from "node:path";
import fs from "fs-extra";
import { auditAuthenticity } from "../domain/byosan/authenticity_audit.js";
import { ExplanationSchema } from "../domain/byosan/explanation.js";
import { ByosanFeatureSpecSchema } from "../domain/byosan/feature_spec.js";
import {
	ByosanScenesConfigSchema,
	compileScenes,
} from "../domain/byosan/scene_spec.js";
import { sha256File } from "../domain/publication_state.js";
import { ROOT, loadConfig } from "../io/core.js";

const BUCKET = "byosan_money";

function parseRunArg(argv: string[]): string {
	const runId = argv[0] === "--run" ? argv[1]?.trim() : undefined;
	if (argv.length !== 2 || !runId?.startsWith(`${BUCKET}/`)) {
		throw new Error(
			`usage: bun src/scripts/audit_byosan_authenticity.ts --run ${BUCKET}/<run>`,
		);
	}
	return runId;
}

function main(): void {
	const runId = parseRunArg(process.argv.slice(2));
	const runName = runId.slice(`${BUCKET}/`.length);
	const cfg = loadConfig(BUCKET) as unknown as {
		workflow: { paths: { runs_dir: string } };
		scenes: unknown;
	};
	const runDir = path.join(ROOT, cfg.workflow.paths.runs_dir, BUCKET, runName);
	const specPath = path.join(runDir, "source", "feature_spec.json");
	const spec = ByosanFeatureSpecSchema.parse(fs.readJsonSync(specPath));
	const explanation = ExplanationSchema.parse(
		fs.readJsonSync(path.join(runDir, "source", "explanation.json")),
	);
	const scenes = compileScenes(
		spec,
		explanation,
		ByosanScenesConfigSchema.parse(cfg.scenes),
	);
	const result = auditAuthenticity({ scenes, featureSpec: spec });

	fs.outputJsonSync(
		path.join(runDir, "audit", "authenticity.json"),
		{
			runId,
			feature_spec_sha256: sha256File(specPath),
			...result,
		},
		{ spaces: 2 },
	);
	console.log(
		`[byosan-authenticity] ${result.status} run=${runId} violations=${result.violations.map((issue) => issue.code).join(",") || "none"}`,
	);
	if (result.status === "FAIL") process.exitCode = 1;
}

main();
