import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { ExplanationSchema } from "../domain/byosan/explanation.js";
import {
	type ByosanFeatureSpec,
	parseAndAuditByosanFeatureSpec,
} from "../domain/byosan/feature_spec.js";
import {
	assertNoSourceNames,
	assertSpeakableLines,
} from "../domain/byosan/spoken_humanizer.js";
import { ROOT } from "../io/core.js";

const FORBIDDEN_PUBLIC_COPY = [
	"Layer 3",
	"Layer3",
	"第3層",
	"第三層",
	"Method A",
	"Method B",
	"Oaktree",
	"IBD",
	"Follow-Through Day",
	"Distribution Day",
	"FRED",
	"BAMLH0A0HYM2",
	"3.77%",
	"3.63%",
	"3.72%",
	"FOMC",
	"2026",
	"2027",
	"保証するものではありません",
	"情報提供を目的とした",
	"投資判断は自己責任",
	"とは言えません",
	"断定できません",
	"可能性があります",
	"予測であり実績ではありません",
];

function publicCopy(spec: ByosanFeatureSpec): string[] {
	return [
		spec.title,
		spec.angle,
		spec.descriptionLead,
		...spec.descriptionBullets,
		...spec.tags,
		...spec.segments.flatMap((segment) => [
			segment.section,
			segment.headline,
			segment.subheadline,
			segment.text,
			...segment.stats.flatMap((stat) => [stat.label, stat.value, stat.detail]),
		]),
	];
}

export function assertByosanEvergreenSpec(spec: ByosanFeatureSpec): void {
	if (spec.production?.format !== "evergreen") {
		throw new Error("BYOSAN_EVERGREEN_FORMAT_REQUIRED");
	}
	if (
		spec.production.targetMinutes < 7 ||
		spec.production.targetMinutes > 10 ||
		spec.production.minSegments < 16 ||
		spec.production.maxSegments > 20 ||
		spec.segments.length < spec.production.minSegments ||
		spec.segments.length > spec.production.maxSegments
	) {
		throw new Error("BYOSAN_EVERGREEN_PACING_PLAN_INVALID");
	}
	const copy = publicCopy(spec);
	const normalized = copy.join("\n").normalize("NFKC").toLowerCase();
	const forbidden = FORBIDDEN_PUBLIC_COPY.find((term) =>
		normalized.includes(term.normalize("NFKC").toLowerCase()),
	);
	if (forbidden)
		throw new Error(`BYOSAN_EVERGREEN_FORBIDDEN_COPY: ${forbidden}`);
	assertSpeakableLines(copy.map((text, index) => ({ index, text })));
	assertNoSourceNames(
		copy.map((text, index) => ({ index, text })),
		spec.sources.map(({ name }) => name),
	);
	const visualTypes = new Set(
		spec.segments.map(({ visualType }) => visualType),
	);
	if (
		!visualTypes.has("if_then") ||
		!visualTypes.has("percentage_bar") ||
		!visualTypes.has("comparison_bars")
	) {
		throw new Error("BYOSAN_EVERGREEN_STRUCTURAL_VISUALS_REQUIRED");
	}
	if (
		spec.segments.filter(({ visualType }) => visualType === "if_then").length <
		2
	) {
		throw new Error("BYOSAN_EVERGREEN_TWO_RULES_REQUIRED");
	}
}

export async function stageByosanEvergreenRun(
	specPath: string,
	explanationPath: string,
): Promise<{ runId: string; runDir: string }> {
	const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(specPath));
	assertByosanEvergreenSpec(spec);
	const explanation = ExplanationSchema.parse(
		await fs.readJson(explanationPath),
	);
	if (!/-evergreen(?:-[a-z0-9]+)*$/u.test(spec.runId)) {
		throw new Error("BYOSAN_EVERGREEN_RUN_ID_REQUIRED");
	}
	const runDir = path.join(ROOT, "runs", spec.runId);
	if (await fs.pathExists(runDir)) {
		const existingSpecPath = path.join(runDir, "source", "feature_spec.json");
		if (!(await fs.pathExists(existingSpecPath))) {
			throw new Error(`BYOSAN_EVERGREEN_RUN_ALREADY_EXISTS: ${spec.runId}`);
		}
		const existingSpec = await fs.readJson(existingSpecPath);
		if (JSON.stringify(existingSpec) !== JSON.stringify(spec)) {
			throw new Error(`BYOSAN_EVERGREEN_RUN_SPEC_MISMATCH: ${spec.runId}`);
		}
		if (await fs.pathExists(path.join(runDir, "publish", "state.json"))) {
			throw new Error(`BYOSAN_EVERGREEN_RUN_ALREADY_PUBLISHED: ${spec.runId}`);
		}
		return { runId: spec.runId, runDir };
	}
	const sourceDir = path.join(runDir, "source");
	await fs.ensureDir(sourceDir);
	await Promise.all([
		fs.outputJson(path.join(sourceDir, "feature_spec.json"), spec, {
			spaces: 2,
		}),
		fs.outputJson(path.join(sourceDir, "explanation.json"), explanation, {
			spaces: 2,
		}),
		fs.copy(specPath, path.join(sourceDir, "input_spec.json")),
		fs.copy(explanationPath, path.join(sourceDir, "input_explanation.json")),
	]);
	return { runId: spec.runId, runDir };
}

async function main(): Promise<void> {
	const specPath = process.argv[2];
	if (!specPath) throw new Error("usage: byosan_evergreen.ts SPEC.json");
	const resolvedSpecPath = path.resolve(specPath);
	const explanationPath = resolvedSpecPath.replace(
		/\.json$/u,
		".explanation.json",
	);
	if (explanationPath === resolvedSpecPath) {
		throw new Error("BYOSAN_EVERGREEN_SPEC_MUST_BE_JSON");
	}
	const { runId } = await stageByosanEvergreenRun(
		resolvedSpecPath,
		explanationPath,
	);
	const result = spawnSync(
		"bun",
		[
			"src/scripts/produce_byosan_feature.ts",
			`runs/${runId}/source/feature_spec.json`,
		],
		{ cwd: ROOT, stdio: "inherit" },
	);
	if (result.status !== 0) {
		throw new Error(
			`BYOSAN_EVERGREEN_PRODUCTION_FAILED: ${result.status ?? "signal"}`,
		);
	}
	console.log(`PUBLISH_READY_RUN=${runId}`);
	console.log(`PUBLISH_COMMAND=task publish PROFILE=byosan -- ${runId}`);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(
			error instanceof Error ? (error.stack ?? error.message) : error,
		);
		process.exit(1);
	});
}
