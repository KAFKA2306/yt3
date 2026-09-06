import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import {
	type ByosanFeatureSpec,
	ByosanFeatureSpecSchema,
} from "../domain/byosan/feature_spec.js";
import { type AgentState, AgentStateSchema } from "../domain/types.js";

export type DigestPeriod = "week" | "month";

export type DigestInput = {
	runId: string;
	runDir: string;
	spec: ByosanFeatureSpec;
	state: AgentState;
	videoPath: string;
};

function parseDate(value: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error(`Digest END must be YYYY-MM-DD; got '${value}'`);
	}
	const parsed = new Date(`${value}T00:00:00Z`);
	if (!Number.isFinite(parsed.getTime())) {
		throw new Error(`Digest END is invalid: '${value}'`);
	}
	return parsed;
}

export function digestStartDate(period: DigestPeriod, end: string): string {
	const endDate = parseDate(end);
	if (period === "week") {
		endDate.setUTCDate(endDate.getUTCDate() - 6);
		return endDate.toISOString().slice(0, 10);
	}
	endDate.setUTCDate(1);
	return endDate.toISOString().slice(0, 10);
}

function normalizeTopicKey(spec: ByosanFeatureSpec): string {
	return spec.searchQuery
		.normalize("NFKC")
		.toLowerCase()
		.replaceAll(/\s+/g, " ")
		.trim();
}

export function dedupeDigestInputs(inputs: DigestInput[]): DigestInput[] {
	const selected = new Map<string, DigestInput>();
	for (const input of [...inputs].sort(
		(left, right) =>
			left.spec.asOf.localeCompare(right.spec.asOf) ||
			left.runId.localeCompare(right.runId),
	)) {
		selected.set(normalizeTopicKey(input.spec), input);
	}
	return [...selected.values()].sort(
		(left, right) =>
			left.spec.asOf.localeCompare(right.spec.asOf) ||
			left.runId.localeCompare(right.runId),
	);
}

function resolveInputVideo(runDir: string, state: AgentState): string {
	const candidate = state.publish_video_path || state.video_path;
	if (!candidate) {
		throw new Error(`Digest input has no video path: ${runDir}`);
	}
	return path.isAbsolute(candidate) ? candidate : path.join(runDir, candidate);
}

function loadDigestInputs(
	root: string,
	period: DigestPeriod,
	end: string,
): DigestInput[] {
	const start = digestStartDate(period, end);
	const bucketDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(bucketDir)) {
		throw new Error(`Digest source bucket does not exist: ${bucketDir}`);
	}
	const discovered = fs
		.readdirSync(bucketDir)
		.filter((name) => /^\d{4}-\d{2}-\d{2}-daily$/.test(name))
		.filter((name) => {
			const date = name.slice(0, 10);
			return date >= start && date <= end;
		})
		.sort();
	if (discovered.length === 0) {
		throw new Error(`Digest has no daily runs in ${start}..${end}`);
	}

	const inputs = discovered.map((runName) => {
		const runDir = path.join(bucketDir, runName);
		const specPath = path.join(runDir, "source", "feature_spec.json");
		const statePath = path.join(runDir, "state.json");
		const qualityPath = path.join(
			runDir,
			"audit",
			"production_quality_report.json",
		);
		for (const required of [specPath, statePath, qualityPath]) {
			if (!fs.existsSync(required)) {
				throw new Error(`Digest input is incomplete: ${required}`);
			}
		}
		const quality = fs.readJsonSync(qualityPath) as { decision?: string };
		if (quality.decision !== "PASS") {
			throw new Error(`Digest input audit is not PASS: ${runName}`);
		}
		const spec = ByosanFeatureSpecSchema.parse(fs.readJsonSync(specPath));
		const state = AgentStateSchema.passthrough().parse(
			fs.readJsonSync(statePath),
		) as AgentState;
		const videoPath = resolveInputVideo(runDir, state);
		if (!fs.existsSync(videoPath)) {
			throw new Error(`Digest input video is missing: ${videoPath}`);
		}
		return {
			runId: `byosan_money/${runName}`,
			runDir,
			spec,
			state,
			videoPath,
		};
	});
	return dedupeDigestInputs(inputs);
}

function concatFileLine(filePath: string): string {
	return `file '${filePath.replaceAll("'", "'\\''")}'`;
}

function runFfmpegConcat(
	inputs: DigestInput[],
	outputPath: string,
	runDir: string,
) {
	const listPath = path.join(runDir, "source", "concat.txt");
	fs.writeFileSync(
		listPath,
		`${inputs.map((input) => concatFileLine(input.videoPath)).join("\n")}\n`,
	);
	const result = spawnSync(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listPath,
			"-c",
			"copy",
			"-movflags",
			"+faststart",
			outputPath,
		],
		{ cwd: process.cwd(), stdio: "inherit" },
	);
	if (result.status !== 0) {
		throw new Error(
			`Digest ffmpeg concat failed with status=${result.status ?? "signal"}`,
		);
	}
}

function uniqueSources(inputs: DigestInput[]) {
	const byUrl = new Map<
		string,
		{ id: string; name: string; url: string; sourceRunIds: string[] }
	>();
	for (const input of inputs) {
		for (const source of input.spec.sources) {
			const existing = byUrl.get(source.url);
			if (existing) {
				if (!existing.sourceRunIds.includes(input.runId)) {
					existing.sourceRunIds.push(input.runId);
				}
				continue;
			}
			byUrl.set(source.url, {
				...source,
				sourceRunIds: [input.runId],
			});
		}
	}
	return [...byUrl.values()].sort((left, right) =>
		left.url.localeCompare(right.url),
	);
}

function writeDigestArtifacts(
	period: DigestPeriod,
	end: string,
	inputs: DigestInput[],
	videoPath: string,
	runDir: string,
) {
	const start = digestStartDate(period, end);
	const label = period === "week" ? "週刊" : "月刊";
	const metadata = {
		title: `【${label}】秒算マネー ${start}〜${end}｜検証済み${inputs.length}本まとめ`,
		thumbnail_title: `${label}まとめ ${inputs.length}本`,
		description: [
			`${start}〜${end}に制作・監査済みの日次動画を、内容を再生成せず時系列で再構成したダイジェストです。`,
			"",
			...inputs.map(
				(input, index) =>
					`${index + 1}. ${input.spec.title} (${input.spec.asOf})`,
			),
		].join("\n"),
		tags: ["秒算マネー", label, "金融", "市場"],
	};
	const scriptLines = inputs.flatMap(
		(input) => input.state.script?.lines ?? [],
	);
	const totalDuration = inputs.reduce(
		(sum, input) => sum + Number(input.state.script?.total_duration ?? 0),
		0,
	);
	const state = AgentStateSchema.passthrough().parse({
		run_id: `byosan_money/${path.basename(runDir)}`,
		bucket: "byosan_money",
		news: uniqueSources(inputs).map((source) => ({
			title: source.name,
			summary: `Verified source reused from ${source.sourceRunIds.join(", ")}`,
			url: source.url,
		})),
		director_data: {
			angle: `${label}ダイジェスト: verified daily runs only`,
			title_hook: metadata.title,
			search_query: `digest ${start} ${end}`,
			key_questions: [],
		},
		script: {
			title: metadata.title,
			description: metadata.description,
			lines: scriptLines,
			total_duration: totalDuration,
		},
		metadata,
		video_path: videoPath,
		publish_video_path: videoPath,
	});
	fs.outputJsonSync(path.join(runDir, "state.json"), state, { spaces: 2 });

	const manifest = {
		schemaVersion: "byosan_digest_v1",
		period,
		start,
		end,
		inputRunIds: inputs.map((input) => input.runId),
		deduplicationKey: "normalized feature_spec.searchQuery; newest run wins",
		inputs: inputs.map((input) => ({
			runId: input.runId,
			asOf: input.spec.asOf,
			title: input.spec.title,
			searchQuery: input.spec.searchQuery,
			videoPath: input.videoPath,
			claims: input.spec.claims,
			sources: input.spec.sources,
		})),
		sources: uniqueSources(inputs),
		materialFactPolicy: "reuse_only_no_new_material_claims",
	};
	fs.outputJsonSync(
		path.join(runDir, "source", "digest_manifest.json"),
		manifest,
		{
			spaces: 2,
		},
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "production_quality_report.json"),
		{
			decision: "PASS",
			generated_at: new Date().toISOString(),
			requirements: {
				input_quality: {
					status: "PASS",
					evidence: inputs.map((input) => input.runId),
				},
				material_claim_reuse: {
					status: "PASS",
					evidence: "No generated bridge narration or new material facts.",
				},
			},
		},
		{ spaces: 2 },
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "result.json"),
		{
			provenance_integrity: {
				status: "PASS",
				critical: true,
				details:
					"Every digest segment reuses a production-audited daily run and retains its claim/source matrix.",
			},
			input_production_quality: {
				status: "PASS",
				critical: true,
				details: inputs.map((input) => input.runId).join(", "),
			},
			material_claim_reuse_only: {
				status: "PASS",
				critical: true,
				details:
					"Digest adds only date range, count, ordering, and source attribution.",
			},
		},
		{ spaces: 2 },
	);
}

export function buildByosanDigest(
	root: string,
	period: DigestPeriod,
	end: string,
	dryRun = false,
) {
	const inputs = loadDigestInputs(root, period, end);
	const suffix = period === "week" ? "weekly-digest" : "monthly-digest";
	const runName = `${end}-${suffix}`;
	const runDir = path.join(root, "runs", "byosan_money", runName);
	const videoPath = path.join(runDir, "media", "video", "publish_video.mp4");
	fs.ensureDirSync(path.join(runDir, "source"));
	fs.ensureDirSync(path.join(runDir, "media", "video"));
	fs.ensureDirSync(path.join(runDir, "audit"));
	fs.ensureDirSync(path.join(runDir, "publish"));

	if (!dryRun) {
		runFfmpegConcat(inputs, videoPath, runDir);
		writeDigestArtifacts(period, end, inputs, videoPath, runDir);
	}
	return {
		runId: `byosan_money/${runName}`,
		runDir,
		videoPath,
		inputRunIds: inputs.map((input) => input.runId),
		period,
		start: digestStartDate(period, end),
		end,
		dryRun,
	};
}

async function main() {
	const period = (process.env.PERIOD || process.argv[2]) as DigestPeriod;
	if (period !== "week" && period !== "month") {
		throw new Error("Digest PERIOD must be week or month");
	}
	const end = process.env.END || process.argv[3];
	if (!end) throw new Error("Digest END=YYYY-MM-DD is required");
	const dryRun = process.argv.includes("--dry-run");
	const result = buildByosanDigest(process.cwd(), period, end, dryRun);
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
