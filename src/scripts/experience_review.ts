import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ExperienceRendererMetricsSchema } from "../domain/experience/audit.js";
import {
	type ExperienceHumanReviewBenchmark,
	type ExperienceHumanReviewReport,
	type ExperienceHumanReviewTemplate,
	auditExperienceHumanReview,
	buildExperienceHumanReviewTemplate,
} from "../domain/experience/human_review.js";
import { CANONICAL_EXPERIENCE_SCENE_IDS } from "../domain/experience/schema.js";

const BenchmarkManifestSchema = z
	.object({
		schema_version: z.literal(1),
		status: z.literal("COMPLETE"),
		decision: z.literal("BENCHMARK_ONLY"),
		run_id: z.string().trim().min(1),
	})
	.passthrough();

type ReviewCommand =
	| { mode: "template"; runDirectory: string; outputPath: string }
	| {
			mode: "audit";
			runDirectory: string;
			reviewPath: string;
			outputPath: string;
	  };

function parseCommand(argv: string[]): ReviewCommand {
	const [mode, ...flags] = argv;
	if (mode !== "template" && mode !== "audit") {
		throw new Error("expected template or audit subcommand");
	}
	const values = new Map<string, string>();
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index];
		if (!flag) throw new Error("unexpected missing argument");
		if (
			(mode === "template" && flag !== "--run" && flag !== "--out") ||
			(mode === "audit" &&
				flag !== "--run" &&
				flag !== "--review" &&
				flag !== "--out")
		) {
			throw new Error(`unknown argument: ${flag}`);
		}
		const value = flags[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${flag} requires a value`);
		}
		if (values.has(flag)) throw new Error(`duplicate argument: ${flag}`);
		values.set(flag, value);
		index += 1;
	}

	const runDirectory = values.get("--run");
	const outputPath = values.get("--out");
	if (!runDirectory) throw new Error("--run is required");
	if (!outputPath) throw new Error("--out is required");
	if (mode === "audit") {
		const reviewPath = values.get("--review");
		if (!reviewPath) throw new Error("--review is required");
		return { mode, runDirectory, reviewPath, outputPath };
	}
	return { mode, runDirectory, outputPath };
}

async function readJson(filePath: string): Promise<unknown> {
	return JSON.parse(await readFile(filePath, "utf8"));
}

async function sha256File(filePath: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(filePath))
		.digest("hex");
}

async function loadBenchmarkReference(
	runDirectoryInput: string,
): Promise<ExperienceHumanReviewBenchmark> {
	const runDirectory = path.resolve(runDirectoryInput);
	const manifest = BenchmarkManifestSchema.parse(
		await readJson(path.join(runDirectory, "manifest.json")),
	);
	if (path.basename(runDirectory) !== manifest.run_id) {
		throw new Error("benchmark run id does not match its directory name");
	}

	const scenes: ExperienceHumanReviewBenchmark["scenes"] = [];
	for (const sceneId of CANONICAL_EXPERIENCE_SCENE_IDS) {
		const baselineVideoPath = path.join(
			runDirectory,
			"scenes",
			sceneId,
			"baseline",
			"render.mp4",
		);
		const baselineMetricsPath = path.join(
			runDirectory,
			"scenes",
			sceneId,
			"baseline",
			"metrics.json",
		);
		const motionCanvasVideoPath = path.join(
			runDirectory,
			"scenes",
			sceneId,
			"motion-canvas",
			"render.mp4",
		);
		const motionCanvasMetricsPath = path.join(
			runDirectory,
			"scenes",
			sceneId,
			"motion-canvas",
			"metrics.json",
		);
		const baseline = ExperienceRendererMetricsSchema.parse(
			await readJson(baselineMetricsPath),
		);
		const motionCanvas = ExperienceRendererMetricsSchema.parse(
			await readJson(motionCanvasMetricsPath),
		);
		if (
			baseline.engine !== "remotion-existing" ||
			baseline.scene_id !== sceneId
		) {
			throw new Error(`baseline metrics do not match scene ${sceneId}`);
		}
		if (
			motionCanvas.engine !== "motion-canvas" ||
			motionCanvas.scene_id !== sceneId
		) {
			throw new Error(`Motion Canvas metrics do not match scene ${sceneId}`);
		}
		const [baselineBytes, motionCanvasBytes] = await Promise.all([
			stat(baselineVideoPath),
			stat(motionCanvasVideoPath),
		]);
		if (
			baselineBytes.size !== baseline.output_bytes ||
			(await sha256File(baselineVideoPath)) !== baseline.output_sha256
		) {
			throw new Error(
				`baseline artifact bytes do not match metrics for ${sceneId}`,
			);
		}
		if (
			motionCanvasBytes.size !== motionCanvas.output_bytes ||
			(await sha256File(motionCanvasVideoPath)) !== motionCanvas.output_sha256
		) {
			throw new Error(
				`Motion Canvas artifact bytes do not match metrics for ${sceneId}`,
			);
		}

		scenes.push({
			scene_id: sceneId,
			baseline_video_path: `scenes/${sceneId}/baseline/render.mp4`,
			baseline_output_sha256: baseline.output_sha256,
			motion_canvas_video_path: `scenes/${sceneId}/motion-canvas/render.mp4`,
			motion_canvas_output_sha256: motionCanvas.output_sha256,
		});
	}

	return { benchmark_run_id: manifest.run_id, scenes };
}

async function writeJsonNew(
	filePathInput: string,
	value: unknown,
): Promise<void> {
	const filePath = path.resolve(filePathInput);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}

export async function prepareExperienceHumanReviewRun(
	runDirectory: string,
	outputPath: string,
): Promise<ExperienceHumanReviewTemplate> {
	const benchmark = await loadBenchmarkReference(runDirectory);
	const template = buildExperienceHumanReviewTemplate(benchmark);
	await writeJsonNew(outputPath, template);
	return template;
}

export async function auditExperienceHumanReviewRun(
	runDirectory: string,
	reviewPathInput: string,
	outputPath: string,
): Promise<ExperienceHumanReviewReport> {
	const benchmark = await loadBenchmarkReference(runDirectory);
	const review = await readJson(path.resolve(reviewPathInput));
	const report = auditExperienceHumanReview(review, benchmark);
	await writeJsonNew(outputPath, report);
	return report;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		const command = parseCommand(argv);
		if (command.mode === "template") {
			const template = await prepareExperienceHumanReviewRun(
				command.runDirectory,
				command.outputPath,
			);
			console.log(
				JSON.stringify(
					{
						status: "TEMPLATE_CREATED",
						benchmark_run_id: template.benchmark_run_id,
						output_path: path.resolve(command.outputPath),
					},
					null,
					2,
				),
			);
			return 0;
		}

		const report = await auditExperienceHumanReviewRun(
			command.runDirectory,
			command.reviewPath,
			command.outputPath,
		);
		console.log(
			JSON.stringify(
				{
					status: "PASS",
					review_status: report.status,
					reviewer_identity_status: report.reviewer_identity_status,
					benchmark_run_id: report.benchmark_run_id,
					output_path: path.resolve(command.outputPath),
				},
				null,
				2,
			),
		);
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exitCode = await main();
