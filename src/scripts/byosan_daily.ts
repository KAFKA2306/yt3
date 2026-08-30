import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { type ResearchResult, TrendScout } from "../domain/agents/research.js";
import {
	ByosanFeatureDraftSchema,
	type ByosanFeatureSource,
	type ByosanFeatureSpec,
	parseAndAuditByosanFeatureSpec,
} from "../domain/byosan/feature_spec.js";
import type { ByosanAngleCandidate } from "../domain/byosan/news_angle.js";
import { AssetStore, ROOT, createLlm, getRunIdDateString } from "../io/core.js";

type FeatureSource = ByosanFeatureSource;

export type PublishedRunEvidence = {
	runId: string;
	verified: boolean;
	reason: string;
	videoId?: string;
};

export type ByosanFailureClass =
	| "INFRA_DEPENDENCY"
	| "NETWORK_AUTH"
	| "PROVIDER_RATE_LIMIT"
	| "PROVIDER_SCHEMA"
	| "SPEC_CONTRACT"
	| "MEDIA_AUDIO"
	| "MEDIA_VIDEO_MOTION"
	| "SUBTITLE"
	| "PUBLISH_REMOTE"
	| "UNCERTAIN_REMOTE_COMMIT"
	| "UNCLASSIFIED";

export type ByosanFailureStage =
	| "RESEARCH"
	| "SPEC"
	| "MEDIA"
	| "PUBLISH"
	| "UNKNOWN";

type RetryPolicy =
	| "TRANSIENT_BOUNDED"
	| "REQUIRES_REPAIR_EVIDENCE"
	| "REMOTE_READBACK_ONLY";

type RepairResolution = {
	status: "VERIFIED";
	root_cause: string;
	regression_test: string;
	repair_commit: string;
	validation: {
		command: "task check:merge";
		status: "PASS";
		checked_at: string;
	};
};

export type ByosanFailureTrace = {
	schema_version: "byosan_failure_trace_v1";
	status: "OPEN" | "RECOVERED";
	failure_class: ByosanFailureClass;
	stage: ByosanFailureStage;
	failed_gate: ByosanFailureStage;
	command?: string;
	symptom: string;
	evidence: string;
	fingerprint: string;
	failed_commit: string;
	retry_policy: RetryPolicy;
	retry_count: number;
	max_retries: number;
	exit_status?: number;
	root_cause: "pending_trace_review";
	regression_test: "pending";
	failed_at: string;
	first_failed_at: string;
	last_retry_at?: string;
	recovered_at?: string;
	resolution?: RepairResolution;
};

function safeSourceId(raw: string, index: number): string {
	const normalized = raw
		.normalize("NFKD")
		.replaceAll(/[^a-zA-Z0-9_-]+/g, "_")
		.replaceAll(/^_+|_+$/g, "")
		.slice(0, 48);
	return normalized || `source_${index + 1}`;
}

function normalizedSources(candidate: ByosanAngleCandidate): FeatureSource[] {
	const seen = new Set<string>();
	return candidate.sources.map((source, index) => {
		let id = safeSourceId(source.id, index);
		while (seen.has(id)) id = `${id}_${index + 1}`;
		seen.add(id);
		return { id, name: source.name, url: source.url };
	});
}

function failureTracePath(runDir: string): string {
	return path.join(runDir, "audit", "failure_trace.json");
}

function currentGitHead(): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	if (result.status !== 0) return "UNVERIFIED";
	return result.stdout.trim() || "UNVERIFIED";
}

function failureStage(message: string): ByosanFailureStage {
	if (/DUPLICATE_PUBLISH|PUBLISH_|publish_youtube/i.test(message))
		return "PUBLISH";
	if (
		/produce_byosan_feature|VOICEVOX|TTS|audio|ffmpeg|motion|zoompan|subtitle/i.test(
			message,
		)
	) {
		return "MEDIA";
	}
	if (/BYOSAN_FEATURE|feature spec|schema|zod|structured/i.test(message))
		return "SPEC";
	if (/BYOSAN_ANGLE|research|TrendScout/i.test(message)) return "RESEARCH";
	return "UNKNOWN";
}

export function classifyByosanFailure(message: string): {
	failureClass: ByosanFailureClass;
	stage: ByosanFailureStage;
	retryPolicy: RetryPolicy;
	maxRetries: number;
} {
	const stage = failureStage(message);
	if (
		/COMMAND_FAILED: .*publish_youtube|DUPLICATE_PUBLISH_BLOCKED|PUBLISH_EVIDENCE_INCOMPLETE/i.test(
			message,
		)
	) {
		return {
			failureClass: "UNCERTAIN_REMOTE_COMMIT",
			stage: "PUBLISH",
			retryPolicy: "REMOTE_READBACK_ONLY",
			maxRetries: 0,
		};
	}
	if (/429|rate limit|quota exhausted|resource exhausted/i.test(message)) {
		return {
			failureClass: "PROVIDER_RATE_LIMIT",
			stage,
			retryPolicy: "TRANSIENT_BOUNDED",
			maxRetries: 2,
		};
	}
	if (
		/oauth|credential|unauthori[sz]ed|forbidden|network|ECONN|ENOTFOUND/i.test(
			message,
		)
	) {
		return {
			failureClass: "NETWORK_AUTH",
			stage,
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	if (/schema|zod|structured output|parse/i.test(message)) {
		return {
			failureClass: "PROVIDER_SCHEMA",
			stage,
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	if (/BYOSAN_FEATURE|SPEC_CONTRACT|feature spec/i.test(message)) {
		return {
			failureClass: "SPEC_CONTRACT",
			stage: "SPEC",
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	if (/VOICEVOX|TTS|audio|speech|duration/i.test(message)) {
		return {
			failureClass: "MEDIA_AUDIO",
			stage: "MEDIA",
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	if (/motion|zoompan|crop|lateral|video motion/i.test(message)) {
		return {
			failureClass: "MEDIA_VIDEO_MOTION",
			stage: "MEDIA",
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	if (/subtitle|caption|srt/i.test(message)) {
		return {
			failureClass: "SUBTITLE",
			stage: "MEDIA",
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	if (/PUBLISH_|youtube/i.test(message)) {
		return {
			failureClass: "PUBLISH_REMOTE",
			stage: "PUBLISH",
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	if (
		/permission|EACCES|EPERM|not found|module|dependency|ffmpeg|ffprobe/i.test(
			message,
		)
	) {
		return {
			failureClass: "INFRA_DEPENDENCY",
			stage,
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	return {
		failureClass: "UNCLASSIFIED",
		stage,
		retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
		maxRetries: 0,
	};
}

function failureFingerprint(
	failureClass: ByosanFailureClass,
	stage: ByosanFailureStage,
	message: string,
): string {
	const canonicalMessage = message.split("\n", 1)[0]?.trim() || message.trim();
	return createHash("sha256")
		.update(`${failureClass}\n${stage}\n${canonicalMessage}`)
		.digest("hex");
}

function readFailureTrace(runDir: string): ByosanFailureTrace | null {
	const tracePath = failureTracePath(runDir);
	if (!fs.existsSync(tracePath)) return null;
	try {
		const trace = fs.readJsonSync(tracePath) as ByosanFailureTrace;
		if (
			trace.schema_version !== "byosan_failure_trace_v1" ||
			!trace.fingerprint ||
			!trace.failure_class ||
			!trace.retry_policy
		) {
			throw new Error("invalid failure trace schema");
		}
		return trace;
	} catch (error) {
		throw new Error(
			`FAILURE_TRACE_UNREADABLE: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function repairResolutionIsValid(
	resolution: RepairResolution | undefined,
	currentHead: string,
): boolean {
	return Boolean(
		resolution?.status === "VERIFIED" &&
			resolution.root_cause.trim() &&
			resolution.regression_test.trim() &&
			resolution.regression_test !== "pending" &&
			resolution.repair_commit === currentHead &&
			resolution.validation.command === "task check:merge" &&
			resolution.validation.status === "PASS" &&
			resolution.validation.checked_at,
	);
}

export function assertByosanRetryAllowed(
	runDir: string,
	currentHead = currentGitHead(),
): void {
	const trace = readFailureTrace(runDir);
	if (!trace || trace.status === "RECOVERED") return;
	if (trace.retry_policy === "REMOTE_READBACK_ONLY") {
		throw new Error(
			`RETRY_BLOCKED_REMOTE_READBACK_REQUIRED: ${trace.failure_class} ${trace.fingerprint}`,
		);
	}
	if (trace.retry_policy === "TRANSIENT_BOUNDED") {
		if (trace.retry_count >= trace.max_retries) {
			throw new Error(
				`RETRY_BLOCKED_TRANSIENT_EXHAUSTED: ${trace.failure_class} ${trace.retry_count}/${trace.max_retries}`,
			);
		}
		fs.outputJsonSync(
			failureTracePath(runDir),
			{
				...trace,
				retry_count: trace.retry_count + 1,
				last_retry_at: new Date().toISOString(),
			},
			{ spaces: 2 },
		);
		return;
	}
	if (!repairResolutionIsValid(trace.resolution, currentHead)) {
		throw new Error(
			`RETRY_BLOCKED_REPAIR_EVIDENCE_REQUIRED: ${trace.failure_class} ${trace.fingerprint}`,
		);
	}
}

export function recordByosanFailure(
	runDir: string,
	error: unknown,
	failedCommit = currentGitHead(),
): ByosanFailureTrace {
	const message = error instanceof Error ? error.message : String(error);
	const evidence =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	const classification = classifyByosanFailure(message);
	const fingerprint = failureFingerprint(
		classification.failureClass,
		classification.stage,
		message,
	);
	const previous = fs.existsSync(failureTracePath(runDir))
		? readFailureTrace(runDir)
		: null;
	const commandMatch = message.match(
		/COMMAND_FAILED:\s+(.+?)\s+status=(\d+|signal)/,
	);
	const now = new Date().toISOString();
	const trace: ByosanFailureTrace = {
		schema_version: "byosan_failure_trace_v1",
		status: "OPEN",
		failure_class: classification.failureClass,
		stage: classification.stage,
		failed_gate: classification.stage,
		...(commandMatch?.[1] ? { command: commandMatch[1] } : {}),
		...(commandMatch?.[2] && commandMatch[2] !== "signal"
			? { exit_status: Number(commandMatch[2]) }
			: {}),
		symptom: message,
		evidence,
		fingerprint,
		failed_commit: failedCommit,
		retry_policy: classification.retryPolicy,
		retry_count:
			previous?.fingerprint === fingerprint ? previous.retry_count : 0,
		max_retries: classification.maxRetries,
		root_cause: "pending_trace_review",
		regression_test: "pending",
		failed_at: now,
		first_failed_at:
			previous?.fingerprint === fingerprint ? previous.first_failed_at : now,
	};
	fs.outputJsonSync(failureTracePath(runDir), trace, { spaces: 2 });
	return trace;
}

function markFailureRecovered(runDir: string): void {
	const trace = readFailureTrace(runDir);
	if (!trace || trace.status === "RECOVERED") return;
	fs.outputJsonSync(
		failureTracePath(runDir),
		{
			...trace,
			status: "RECOVERED",
			recovered_at: new Date().toISOString(),
		},
		{ spaces: 2 },
	);
}

export function findPublishedByosanRunForDate(
	root: string,
	date: string,
): PublishedRunEvidence | null {
	const bucketDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(bucketDir)) return null;
	for (const runName of fs
		.readdirSync(bucketDir)
		.filter((name) => name.startsWith(date))
		.sort()
		.reverse()) {
		const publishDir = path.join(bucketDir, runName, "publish");
		const receiptPath = path.join(publishDir, "receipt.json");
		if (!fs.existsSync(receiptPath)) continue;
		try {
			const receipt = fs.readJsonSync(receiptPath) as {
				youtube?: {
					status?: string;
					video_id?: string;
					channel_id?: string;
					privacy_status?: string;
				};
			};
			const visibilityPath = path.join(
				publishDir,
				"visibility_attestation.json",
			);
			const thumbnailPath = path.join(publishDir, "thumbnail_attestation.json");
			const visibility = fs.existsSync(visibilityPath)
				? (fs.readJsonSync(visibilityPath) as {
						current_privacy_status?: string;
						channel_id?: string;
					})
				: undefined;
			const thumbnail = fs.existsSync(thumbnailPath)
				? (fs.readJsonSync(thumbnailPath) as { api_update_status?: string })
				: undefined;
			const youtube = receipt.youtube;
			const uploaded =
				youtube?.status === "uploaded" && Boolean(youtube.video_id);
			const verified =
				uploaded &&
				youtube?.channel_id === "UCYtjO-PYBfdG3MuPLXfhA-Q" &&
				youtube?.privacy_status === "public" &&
				visibility?.current_privacy_status === "public" &&
				visibility.channel_id === "UCYtjO-PYBfdG3MuPLXfhA-Q" &&
				thumbnail?.api_update_status === "succeeded";
			return {
				runId: `byosan_money/${runName}`,
				verified,
				reason: verified
					? "receipt_visibility_thumbnail_verified"
					: "upload_receipt_exists_but_attestation_is_incomplete",
				videoId: youtube?.video_id,
			};
		} catch {
			return {
				runId: `byosan_money/${runName}`,
				verified: false,
				reason: "publish_receipt_is_unreadable",
			};
		}
	}
	return null;
}

function selectedCandidate(research: ResearchResult): ByosanAngleCandidate {
	const decision = research.angle_decision;
	if (
		!decision ||
		decision.decision !== "PASS" ||
		decision.selectedIndex === null
	) {
		throw new Error(
			"BYOSAN_ANGLE_STOP: research has no passing angle decision",
		);
	}
	const candidate = decision.evaluated[decision.selectedIndex]?.candidate;
	if (!candidate) {
		throw new Error("BYOSAN_ANGLE_STOP: selected candidate is missing");
	}
	return candidate;
}

async function generateFeatureSpec(
	research: ResearchResult,
	candidate: ByosanAngleCandidate,
	sources: FeatureSource[],
	runDir: string,
	runId: string,
	date: string,
): Promise<ByosanFeatureSpec> {
	const llm = createLlm({
		temperature: 0.28,
		sessionId: runDir,
	});
	const structured = llm.withStructuredOutput(ByosanFeatureDraftSchema, {
		name: "byosan_feature_draft",
	});
	const evidence = {
		candidate,
		allowed_sources: sources,
		news: research.news,
	};
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const draft = await structured.invoke([
				{
					role: "system",
					content:
						"あなたは秒算マネーの編集長です。与えられた証拠だけで5〜7分の対話型金融動画を設計します。出典にない数字や断定を作らないでください。推計はderived_with_caveatまたはanalyst_estimate_not_company_non_gaapとし、条件を台本と説明欄へ入れます。冒頭2シーンでhookPromisesをすべて文字列一致で回収します。20〜32シーン、7種類以上のemotion、春日部つむぎとずんだもんの対話、各シーン1〜3個の短いstatsを使います。画面は中心固定で、左右揺れを前提にしたvisualPlanを書かないでください。claimsのsourceIdsにはallowed_sourcesのidだけを使ってください。毎回新しい比較単位、章構成、問いの順番を選びます。",
				},
				{
					role: "user",
					content: `対象証拠:\n${JSON.stringify(evidence, null, 2)}\n\n制約: タイトル100文字以下。thumbnailTitleとthumbnailは同じ主張を表す。hookPromisesはcandidate.numbersから2〜4個を原表記のまま選ぶ。noveltyQueriesはYouTube上の完全一致・類似角度を点検できる検索式にする。descriptionBulletsは重要な限定条件を3〜8件含める。attempt=${attempt}\n前回の検証エラー: ${lastError instanceof Error ? lastError.message : lastError ? String(lastError) : "なし"}`,
				},
			]);
			return parseAndAuditByosanFeatureSpec({
				...draft,
				schemaVersion: "byosan_feature_v1",
				runId,
				asOf: date,
				angle: candidate.angle,
				searchQuery: research.director_data.search_query,
				sources,
			});
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error(
		`BYOSAN_FEATURE_GENERATION_FAILED: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	);
}

function runCommand(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): void {
	const result = spawnSync(command, args, {
		cwd: ROOT,
		env,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		throw new Error(
			`COMMAND_FAILED: ${command} ${args.join(" ")} status=${result.status ?? "signal"}`,
		);
	}
}

function assertPublishEvidence(runDir: string): void {
	const report = fs.readJsonSync(
		path.join(runDir, "audit", "production_quality_report.json"),
	) as { decision?: string };
	if (report.decision !== "PASS") {
		throw new Error("PUBLISH_BLOCKED: production audit is not PASS");
	}
	const runName = path.basename(runDir);
	const evidence = findPublishedByosanRunForDate(ROOT, runName.slice(0, 10));
	if (!evidence?.verified || evidence.runId !== `byosan_money/${runName}`) {
		throw new Error(
			`PUBLISH_EVIDENCE_INCOMPLETE: ${evidence?.reason ?? "missing_receipt"}`,
		);
	}
}

async function dryRun(): Promise<void> {
	const referencePath = path.join(
		ROOT,
		"config",
		"productions",
		"sp500_anthropic_2026q2.json",
	);
	const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(referencePath));
	console.log(
		JSON.stringify(
			{
				status: "DRY_RUN_PASS",
				schema: spec.schemaVersion,
				scenes: spec.segments.length,
				sources: spec.sources.length,
				hookPromises: spec.hookPromises,
				publish: false,
			},
			null,
			2,
		),
	);
}

export async function runByosanDaily(): Promise<void> {
	if (
		process.argv.includes("--dry-run") ||
		process.env.BYOSAN_DAILY_DRY_RUN === "true"
	) {
		await dryRun();
		return;
	}
	const date = process.env.BYOSAN_DATE?.trim() || getRunIdDateString();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new Error(`Invalid BYOSAN_DATE: ${date}`);
	}
	const existing = findPublishedByosanRunForDate(ROOT, date);
	if (existing) {
		if (!existing.verified) {
			throw new Error(
				`DUPLICATE_PUBLISH_BLOCKED: ${existing.runId} ${existing.reason}`,
			);
		}
		console.log(
			`ALREADY_PUBLISHED=${existing.runId} VIDEO_ID=${existing.videoId ?? "unknown"}`,
		);
		return;
	}

	const runId = `byosan_money/${date}-daily`;
	const store = new AssetStore(runId);
	assertByosanRetryAllowed(store.runDir);
	const missionPath = path.join(store.runDir, "source", "no-mission-file.md");
	const scout = new TrendScout(store);
	const research = await scout.run("byosan_money", 5, missionPath);
	await fs.outputJson(
		path.join(store.runDir, "source", "research_result.json"),
		research,
		{
			spaces: 2,
		},
	);
	const candidate = selectedCandidate(research);
	const sources = normalizedSources(candidate);
	const spec = await generateFeatureSpec(
		research,
		candidate,
		sources,
		store.runDir,
		runId,
		date,
	);
	const specPath = path.join(store.runDir, "source", "feature_spec.json");
	await fs.outputJson(specPath, spec, { spaces: 2 });
	await fs.outputJson(
		path.join(store.runDir, "audit", "loop_manifest.json"),
		{
			execution_layer: "agent loop",
			validation_layer: "closed-loop agent workflow",
			improvement_layer: "agent improvement loop / harness design",
			angle_decision: research.angle_decision,
			feature_spec: specPath,
			motion_policy: "center_locked_no_lateral_oscillation",
			generated_at: new Date().toISOString(),
		},
		{ spaces: 2 },
	);

	runCommand(
		process.execPath,
		["src/scripts/produce_byosan_feature.ts", specPath],
		{
			...process.env,
			ENV_FILE: "config/.env.byosan",
			YOUTUBE_CHANNEL_PROFILE: "byosan",
		},
	);
	if (process.env.BYOSAN_DAILY_NO_PUBLISH === "true") {
		markFailureRecovered(store.runDir);
		console.log(`PRODUCTION_PASS_NO_PUBLISH=${runId}`);
		return;
	}
	runCommand(process.execPath, ["src/scripts/publish_youtube.ts", runId], {
		...process.env,
		ENV_FILE: "config/.env.byosan",
		YOUTUBE_CHANNEL_PROFILE: "byosan",
		RUN_ID: runId,
	});
	assertPublishEvidence(store.runDir);
	markFailureRecovered(store.runDir);
	console.log(`BYOSAN_DAILY_PASS=${runId}`);
}

if (import.meta.main) {
	runByosanDaily().catch((error) => {
		const failureDate = process.env.BYOSAN_DATE?.trim() || getRunIdDateString();
		const failureRunDir = path.join(
			ROOT,
			"runs",
			"byosan_money",
			`${failureDate}-daily`,
		);
		const message = error instanceof Error ? error.message : String(error);
		if (
			fs.existsSync(failureRunDir) &&
			!message.startsWith("RETRY_BLOCKED_") &&
			!message.startsWith("FAILURE_TRACE_UNREADABLE")
		) {
			try {
				recordByosanFailure(failureRunDir, error);
			} catch (traceError) {
				console.error(
					traceError instanceof Error
						? (traceError.stack ?? traceError.message)
						: traceError,
				);
			}
		}
		console.error(
			error instanceof Error ? (error.stack ?? error.message) : error,
		);
		process.exit(1);
	});
}
