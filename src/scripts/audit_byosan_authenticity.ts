import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	type ByosanAuthenticityAuditConfig,
	ByosanAuthenticityAuditConfigSchema,
	type ByosanPreviousRun,
	auditAuthenticity,
} from "../domain/byosan/authenticity_audit.js";
import { ExplanationSchema } from "../domain/byosan/explanation.js";
import { ByosanFeatureSpecSchema } from "../domain/byosan/feature_spec.js";
import { compileScenes } from "../domain/byosan/scene_spec.js";
import { sha256File } from "../domain/publication_state.js";
import { ROOT, loadConfig } from "../io/core.js";

const BUCKET = "byosan_money";

const PublishedSpecSchema = z.object({
	asOf: z.string(),
	segments: z.array(z.object({ visualType: z.string() })),
});

function parseRunArg(argv: string[]): string {
	const runId = argv[0] === "--run" ? argv[1]?.trim() : undefined;
	if (argv.length !== 2 || !runId?.startsWith(`${BUCKET}/`)) {
		throw new Error(
			`usage: bun src/scripts/audit_byosan_authenticity.ts --run ${BUCKET}/<run>`,
		);
	}
	return runId;
}

function readPublishedRuns(
	bucketDir: string,
	currentRun: string,
): ByosanPreviousRun[] {
	return fs
		.readdirSync(bucketDir)
		.filter((name) => name !== currentRun)
		.filter(
			(name) =>
				fs.existsSync(path.join(bucketDir, name, "publish", "receipt.json")) &&
				fs.existsSync(
					path.join(bucketDir, name, "source", "feature_spec.json"),
				),
		)
		.map((name) => {
			const spec = PublishedSpecSchema.parse(
				fs.readJsonSync(
					path.join(bucketDir, name, "source", "feature_spec.json"),
				),
			);
			return {
				asOf: spec.asOf,
				sequence: spec.segments.map((segment) => segment.visualType),
			};
		});
}

function main(): void {
	const runId = parseRunArg(process.argv.slice(2));
	const runName = runId.slice(`${BUCKET}/`.length);
	const cfg = loadConfig(BUCKET) as unknown as {
		workflow: { paths: { runs_dir: string } };
		scenes: unknown;
		authenticity: unknown;
	};
	const bucketDir = path.join(ROOT, cfg.workflow.paths.runs_dir, BUCKET);
	const runDir = path.join(bucketDir, runName);
	const specPath = path.join(runDir, "source", "feature_spec.json");

	const config: ByosanAuthenticityAuditConfig =
		ByosanAuthenticityAuditConfigSchema.parse({
			scenes: cfg.scenes,
			authenticity: cfg.authenticity,
		});
	const spec = ByosanFeatureSpecSchema.parse(fs.readJsonSync(specPath));
	const explanation = ExplanationSchema.parse(
		fs.readJsonSync(path.join(runDir, "source", "explanation.json")),
	);
	const scenes = compileScenes(spec, explanation, config.scenes);
	const result = auditAuthenticity({
		scenes,
		featureSpec: spec,
		explanation,
		previousRuns: readPublishedRuns(bucketDir, runName),
		config,
	});

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
