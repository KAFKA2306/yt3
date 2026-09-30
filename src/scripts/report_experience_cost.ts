import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
	ExperienceLaneCostSummarySchema,
	type ExperienceRendererMetrics,
	ExperienceRendererMetricsSchema,
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

async function findMetricFiles(directory: string): Promise<string[]> {
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
			files.push(...(await findMetricFiles(entryPath)));
		} else if (entry.isFile() && entry.name === "metrics.json") {
			files.push(entryPath);
		}
	}
	return files;
}

async function readMetric(filePath: string): Promise<CollectedMetric> {
	const contents = await readFile(filePath);
	let value: unknown;
	try {
		value = JSON.parse(contents.toString("utf8"));
	} catch (error) {
		throw new Error(
			`invalid JSON in Experience renderer metrics ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
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

export async function generateExperienceCostReport(
	rootPath: string,
	outputPath: string,
): Promise<ExperienceCostReport> {
	const root = path.resolve(rootPath);
	const output = path.resolve(outputPath);
	if (path.basename(output) === "metrics.json") {
		throw new Error("report output must not be named metrics.json");
	}
	if (!(await stat(root)).isDirectory()) {
		throw new Error(`benchmark root is not a directory: ${root}`);
	}
	const files = await findMetricFiles(root);
	if (files.length === 0) {
		throw new Error(
			`no metrics.json files found under benchmark root: ${root}`,
		);
	}
	if (files.includes(output)) {
		throw new Error("report output must not overwrite an input metrics file");
	}
	const collected = await Promise.all(files.map(readMetric));
	const report = ExperienceCostReportSchema.parse({
		...buildExperienceLaneCostSummary(collected.map((item) => item.metrics)),
		inputs: collected.map(({ path: filePath, sha256 }) => ({
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
