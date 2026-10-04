import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
	ExperienceLaneCostSummarySchema,
	type ExperienceRendererMetrics,
	ExperienceRendererMetricsSchema,
	type TtsGenerationManifest,
	TtsGenerationManifestSchema,
	buildExperienceLaneCostSummary,
} from "../domain/experience/audit.js";

const ExperienceCostReportSchema = ExperienceLaneCostSummarySchema.extend({
	inputs: z.array(
		z.object({
			path: z.string().min(1),
			sha256: z.string().regex(/^[a-f0-9]{64}$/),
		}),
	),
});

export type ExperienceCostReport = z.infer<typeof ExperienceCostReportSchema>;

interface CollectedMetric {
	metrics: ExperienceRendererMetrics;
	path: string;
	sha256: string;
}

interface CollectedGenerationManifest {
	manifest: TtsGenerationManifest;
	path: string;
	sha256: string;
}

interface CollectedInput {
	path: string;
	sha256: string;
}

async function findInputFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries.sort((left, right) =>
		left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
	)) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isSymbolicLink()) {
			throw new Error(`symlinked benchmark path is not allowed: ${entryPath}`);
		}
		if (entry.isDirectory()) {
			files.push(...(await findInputFiles(entryPath)));
		} else if (
			entry.isFile() &&
			(entry.name === "metrics.json" ||
				/^tts-manifest-.+\.json$/.test(entry.name))
		) {
			files.push(entryPath);
		}
	}
	return files;
}

async function readJsonInput(filePath: string): Promise<{
	value: unknown;
	contents: Buffer;
}> {
	const contents = await readFile(filePath);
	let value: unknown;
	try {
		value = JSON.parse(contents.toString("utf8"));
	} catch (error) {
		throw new Error(
			`invalid JSON in Experience cost input ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return { value, contents };
}

async function readMetric(filePath: string): Promise<CollectedMetric> {
	const { value, contents } = await readJsonInput(filePath);
	const parsed = ExperienceRendererMetricsSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`invalid Experience renderer metrics ${filePath}: ${parsed.error.message}`,
		);
	}
	return {
		metrics: parsed.data,
		path: filePath,
		sha256: createHash("sha256").update(contents).digest("hex"),
	};
}

async function readGenerationManifest(
	filePath: string,
): Promise<CollectedGenerationManifest> {
	const { value, contents } = await readJsonInput(filePath);
	const parsed = TtsGenerationManifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`invalid TTS generation manifest ${filePath}: ${parsed.error.message}`,
		);
	}
	return {
		manifest: parsed.data,
		path: filePath,
		sha256: createHash("sha256").update(contents).digest("hex"),
	};
}

export async function generateExperienceCostReport(
	rootPath: string,
	outputPath: string,
): Promise<ExperienceCostReport> {
	const root = path.resolve(rootPath);
	const output = path.resolve(outputPath);
	if (
		path.basename(output) === "metrics.json" ||
		/^tts-manifest-.+\.json$/.test(path.basename(output))
	) {
		throw new Error("report output must not use an Experience cost input name");
	}
	if (!(await stat(root)).isDirectory()) {
		throw new Error(`benchmark root is not a directory: ${root}`);
	}
	const files = await findInputFiles(root);
	if (files.length === 0) {
		throw new Error(
			`no metrics.json or TTS generation manifests found under benchmark root: ${root}`,
		);
	}
	if (files.includes(output)) {
		throw new Error(
			"report output must not overwrite an Experience cost input",
		);
	}
	const [metricFiles, manifestFiles] = [
		files.filter((file) => path.basename(file) === "metrics.json"),
		files.filter((file) => /^tts-manifest-.+\.json$/.test(path.basename(file))),
	];
	const [collectedMetrics, collectedManifests] = await Promise.all([
		Promise.all(metricFiles.map(readMetric)),
		Promise.all(manifestFiles.map(readGenerationManifest)),
	]);
	const collectedInputs: CollectedInput[] = [
		...collectedMetrics,
		...collectedManifests,
	].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
	const report = ExperienceCostReportSchema.parse({
		...buildExperienceLaneCostSummary(
			collectedMetrics.map((item) => item.metrics),
			collectedManifests.map((item) => item.manifest),
		),
		inputs: collectedInputs.map(({ path: filePath, sha256 }) => ({
			path: path.relative(root, filePath).split(path.sep).join("/"),
			sha256,
		})),
	});
	await mkdir(path.dirname(output), { recursive: true });
	await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return report;
}

function requiredArg(argv: string[], name: string): string {
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === `--${name}`) return argv[index + 1] ?? "";
	}
	throw new Error(`--${name} is required`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		const report = await generateExperienceCostReport(
			requiredArg(argv, "root"),
			requiredArg(argv, "out"),
		);
		console.log(
			JSON.stringify(
				{
					status: "PASS",
					input_count: report.inputs.length,
					metrics_without_lane: report.metrics_without_lane,
					generation_manifests_without_lane:
						report.generation_manifests_without_lane,
					output: path.resolve(requiredArg(argv, "out")),
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

if (import.meta.main) process.exit(await main());
