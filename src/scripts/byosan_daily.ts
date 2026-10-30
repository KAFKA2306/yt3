import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	buildCanonicalAudit,
	hostOf,
} from "../domain/byosan/canonical_audit.js";
import {
	reconcileByosanCheckpoint,
	writeByosanCheckpoint,
} from "../domain/byosan/checkpoint.js";
import {
	type ByosanFailureClassification,
	type ExecBackend,
	type StructuredCall,
	byosanFailureClassification,
	byosanLlmConfig,
	codexLlmLogPath,
	failureSignalLines,
	invokeCodexStructured,
	llmBackend,
	structuredRequest,
	termsMatch,
} from "../domain/byosan/codex_llm.js";
import {
	loadDialogueStyle,
	renderDialogueStylePrompt,
} from "../domain/byosan/dialogue_style.js";
import {
	type Explanation,
	ExplanationSchema,
} from "../domain/byosan/explanation.js";
import { auditFeatureSpecAgainstExplanation } from "../domain/byosan/explanation_contract.js";
import {
	DraftArticlesSchema,
	type FeatureDraftInput,
	type Json,
	buildFeatureSpecInput,
	featureDraftIssues,
	inputSourceText,
	isJson,
	normalizeFeatureDraft,
	prepareFeatureDraftInput,
	renderFeatureDraftInput,
	summarizeFeatureIssues,
} from "../domain/byosan/feature_draft.js";
import {
	ByosanFeatureDraftSchema,
	type ByosanFeatureSpec,
	auditByosanFeatureSpec,
	isBlockingFeatureIssue,
	loadFeatureReview,
	parseAndAuditByosanFeatureSpec,
} from "../domain/byosan/feature_spec.js";
import {
	type DiscoveryConfig,
	loadDiscoveryBaseline,
	writeDiscoveryEvidence,
} from "../domain/byosan/feed_discovery.js";
import { byosanFontconfigEnv } from "../domain/byosan/fonts.js";
import { loadPublishedByosanSourceUrls } from "../domain/byosan/published_sources.js";
import {
	AssetStore,
	ROOT,
	getRunIdDateString,
	invokeStructuredLlm,
	loadConfig,
	zodSizeConstraintLines,
} from "../io/core.js";

type DailyConfig = {
	discovery: DiscoveryConfig & { repeat_window_days: number };
	feature_draft: { system: string };
};

const dailyConfig = (): DailyConfig =>
	loadConfig("byosan_money") as unknown as DailyConfig;

const FEATURE_DRAFT_SIZE_LIMITS = zodSizeConstraintLines(
	ByosanFeatureDraftSchema,
).join("\n");

type PublishedRunEvidence = {
	runId: string;
	verified: boolean;
	reason: string;
	videoId?: string;
};

export type ByosanFailureClass =
	| "INFRA_DEPENDENCY"
	| "NETWORK_AUTH"
	| "PROVIDER_RATE_LIMIT"
	| "RESEARCH_ANGLE_STOP"
	| "PUBLISH_REMOTE"
	| "UNCERTAIN_REMOTE_COMMIT"
	| "PIPELINE_FAILURE";

type ByosanFailureStage = "RESEARCH" | "SPEC" | "MEDIA" | "PUBLISH" | "UNKNOWN";

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
	exit_status?: number;
	failed_at: string;
	first_failed_at: string;
	recovered_at?: string;
};

export function failureTracePath(runDir: string): string {
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

export function classifyByosanFailure(
	rawMessage: string,
	classification: ByosanFailureClassification = byosanFailureClassification(),
): {
	failureClass: ByosanFailureClass;
	stage: ByosanFailureStage;
} {
	const stage = failureStage(rawMessage);
	const message = failureSignalLines(
		rawMessage,
		classification.mcp_noise_terms,
	).join("\n");
	if (/BYOSAN_ANGLE_STOP/.test(message)) {
		return { failureClass: "RESEARCH_ANGLE_STOP", stage: "RESEARCH" };
	}
	if (
		/COMMAND_FAILED: .*publish_youtube|DUPLICATE_PUBLISH_BLOCKED|PUBLISH_EVIDENCE_INCOMPLETE/i.test(
			message,
		)
	) {
		return { failureClass: "UNCERTAIN_REMOTE_COMMIT", stage: "PUBLISH" };
	}
	if (termsMatch(message, classification.rate_limit_terms)) {
		return { failureClass: "PROVIDER_RATE_LIMIT", stage };
	}
	if (termsMatch(message, classification.auth_terms)) {
		return { failureClass: "NETWORK_AUTH", stage };
	}
	if (/PUBLISH_|\byoutube\b/i.test(message)) {
		return { failureClass: "PUBLISH_REMOTE", stage: "PUBLISH" };
	}
	if (
		/permission|EACCES|EPERM|not found|module|dependency|ffmpeg|ffprobe/i.test(
			message,
		)
	) {
		return { failureClass: "INFRA_DEPENDENCY", stage };
	}
	return { failureClass: "PIPELINE_FAILURE", stage };
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
			!trace.failure_class
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

export function assertByosanRetryAllowed(runDir: string): void {
	const trace = readFailureTrace(runDir);
	if (
		trace?.status === "OPEN" &&
		trace.failure_class === "UNCERTAIN_REMOTE_COMMIT"
	) {
		throw new Error(
			`RETRY_BLOCKED_REMOTE_READBACK_REQUIRED: ${trace.failure_class} ${trace.fingerprint}`,
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
	const sameFailure = previous?.fingerprint === fingerprint;
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
		failed_at: now,
		first_failed_at: sameFailure ? previous.first_failed_at : now,
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
	wanted: string,
): PublishedRunEvidence | null {
	const bucketDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(bucketDir)) return null;
	for (const runName of fs
		.readdirSync(bucketDir)
		.filter((name) => name === wanted)
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

export async function generateFeatureSpec(
	input: FeatureDraftInput,
	runDir: string,
	exec?: (prompt: string) => string,
): Promise<{ spec: ByosanFeatureSpec; explanation: Explanation }> {
	const titleRule = dailyConfig().discovery.title_rule;
	const system = `${dailyConfig().feature_draft.system}\n${renderDialogueStylePrompt(loadDialogueStyle())}`;
	const review = loadFeatureReview();
	const llm = byosanLlmConfig();
	const articles = renderFeatureDraftInput(input);
	const write = async (label: string, extra: string) => {
		const request = structuredRequest({
			maxAttempts: llm.max_attempts,
			schema: z.unknown(),
			providerSchema: ByosanFeatureDraftSchema,
			name: "byosan_feature_draft",
			exec,
			evidencePath: path.join(
				runDir,
				"audit",
				`structured_feature_attempts_${label}.json`,
			),
			messages: (attempt, lastValidationError) => [
				{ role: "system", content: system },
				{
					role: "user",
					content: `${articles}${extra}\n\n制約（ByosanFeatureDraftSchema から導出した文字数・件数の上限と下限）:\n${FEATURE_DRAFT_SIZE_LIMITS}\n\n${titleRule}\n\nattempt=${attempt}\n前回の検証エラー: ${lastValidationError ?? "なし"}`,
				},
			],
			validate: (rawDraft) => {
				if (!isJson(rawDraft)) {
					throw new Error(
						"BYOSAN_FEATURE_DRAFT_INVALID: draft must be a JSON object",
					);
				}
				const normalized = normalizeFeatureDraft(rawDraft);
				const blocking = featureDraftIssues(normalized.draft, input).filter(
					(issue) => isBlockingFeatureIssue(issue, review),
				);
				if (blocking.length > 0) {
					throw new Error(
						`BYOSAN_FEATURE_DRAFT_INVALID: ${summarizeFeatureIssues(blocking)}`,
					);
				}
				return normalized;
			},
		});
		const { draft, corrections } =
			llmBackend(llm, "feature") !== "gemini"
				? await invokeCodexStructured({
						llm,
						logPath: codexLlmLogPath(runDir),
						backend: llmBackend(llm, "feature") as ExecBackend,
						...request,
					})
				: await invokeStructuredLlm({
						...request,
						llmOptions: { temperature: 0.28, sessionId: runDir },
					});
		fs.outputJsonSync(
			path.join(runDir, "audit", `feature_corrections_${label}.json`),
			corrections,
			{ spaces: 2 },
		);
		const parsed = ByosanFeatureDraftSchema.parse(draft);
		return {
			parsed,
			spec: parseAndAuditByosanFeatureSpec(
				buildFeatureSpecInput(parsed, input),
			),
		};
	};
	const { parsed, spec } = await write("1_1", "");
	return { spec, explanation: parsed.explanation };
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

function byosanAllowedSourceHosts(): string[] {
	const config = loadConfig("byosan_money") as unknown as {
		discovery: { registry: string };
		source_policy: {
			power_macro_registry: string;
			tier1_sources: { url: string }[];
		};
	};
	const discovery = z
		.object({ sources: z.array(z.object({ domain: z.string().min(1) })) })
		.parse(fs.readJsonSync(path.join(ROOT, config.discovery.registry)));
	const macro = z
		.object({ sources: z.array(z.object({ url: z.string().url() })) })
		.parse(
			fs.readJsonSync(
				path.join(ROOT, config.source_policy.power_macro_registry),
			),
		);
	return [
		...discovery.sources.map((source) => source.domain),
		...macro.sources.map((source) => hostOf(source.url)),
		...config.source_policy.tier1_sources.map((source) => hostOf(source.url)),
	];
}

function writeByosanCanonicalAudit(
	runDir: string,
	spec: ByosanFeatureSpec,
	sourceText: string,
): void {
	const explanationPath = path.join(runDir, "source", "explanation.json");
	const explanation = ExplanationSchema.parse(fs.readJsonSync(explanationPath));
	const review = loadFeatureReview();
	const contractIssues = auditFeatureSpecAgainstExplanation(
		spec,
		explanation,
		sourceText,
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "feature_warnings.json"),
		[...auditByosanFeatureSpec(spec), ...contractIssues].filter(
			(issue) => !isBlockingFeatureIssue(issue, review),
		),
		{ spaces: 2 },
	);
	const explanationIssues = contractIssues
		.filter((issue) => isBlockingFeatureIssue(issue, review))
		.map((issue) => `${issue.code}:${issue.details}`);
	const productionReportPath = path.join(
		runDir,
		"audit",
		"production_quality_report.json",
	);
	const productionReport = z
		.object({
			decision: z.string(),
			requirements: z.record(z.string(), z.object({ status: z.string() })),
		})
		.passthrough()
		.parse(fs.readJsonSync(productionReportPath));
	const authenticityPath = path.join(runDir, "audit", "authenticity.json");
	const authenticity = z
		.object({ status: z.string() })
		.passthrough()
		.parse(fs.readJsonSync(authenticityPath));
	const checks = buildCanonicalAudit({
		claims: spec.claims,
		sources: spec.sources,
		explanationIssues,
		allowedHosts: byosanAllowedSourceHosts(),
		productionReport: {
			path: productionReportPath,
			decision: productionReport.decision,
			requirements: productionReport.requirements,
		},
		authenticity: { path: authenticityPath, status: authenticity.status },
		specPath: path.join(runDir, "source", "feature_spec.json"),
		explanationPath,
	});
	const failed = Object.values(checks)
		.filter((check) => check.status !== "PASS")
		.map((check) => `${check.name}: ${check.details}`);
	if (failed.length > 0) {
		throw new Error(`CANONICAL_AUDIT_FAILED: ${failed.join(" | ")}`);
	}
	fs.outputJsonSync(path.join(runDir, "audit", "result.json"), checks, {
		spaces: 2,
	});
}

async function runByosanDaily(): Promise<void> {
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
	const runId = `byosan_money/${date}-daily${process.env.BYOSAN_SUFFIX ?? ""}`;
	const store = new AssetStore(runId);
	const checkpoint = reconcileByosanCheckpoint(store.runDir, runId, ROOT);
	writeByosanCheckpoint(store.runDir, checkpoint);
	const articlesPath = path.join(
		store.runDir,
		"research",
		"discovery_articles.json",
	);
	const specPath = path.join(store.runDir, "source", "feature_spec.json");
	const explanationPath = path.join(store.runDir, "source", "explanation.json");
	assertByosanRetryAllowed(store.runDir);
	const { discovery } = dailyConfig();
	if (
		!(checkpoint.stages.research_ready && (await fs.pathExists(articlesPath)))
	) {
		await writeDiscoveryEvidence(discovery, store.runDir, new Date());
		checkpoint.stages.research_ready = true;
		writeByosanCheckpoint(store.runDir, checkpoint);
	}
	const input = prepareFeatureDraftInput({
		runId,
		asOf: date,
		today: DraftArticlesSchema.parse(await fs.readJson(articlesPath)),
		baseline: loadDiscoveryBaseline(discovery, new Date()),
		publishedUrls: loadPublishedByosanSourceUrls(
			ROOT,
			new Date(`${date}T23:59:59Z`),
			discovery.repeat_window_days,
		),
	});
	let spec: ByosanFeatureSpec;
	if (checkpoint.stages.spec_ready && (await fs.pathExists(specPath))) {
		spec = parseAndAuditByosanFeatureSpec(await fs.readJson(specPath));
	} else {
		const generated = await generateFeatureSpec(input, store.runDir);
		spec = generated.spec;
		await fs.outputJson(explanationPath, generated.explanation, { spaces: 2 });
		await fs.outputJson(specPath, spec, { spaces: 2 });
		checkpoint.stages.spec_ready = true;
		writeByosanCheckpoint(store.runDir, checkpoint);
	}

	const finalVideoPath = path.join(
		store.runDir,
		"media",
		"video",
		"publish_video.mp4",
	);
	const qualityReportPath = path.join(
		store.runDir,
		"audit",
		"production_quality_report.json",
	);
	if (
		!(
			checkpoint.stages.media_ready &&
			checkpoint.stages.quality_pass &&
			(await fs.pathExists(finalVideoPath)) &&
			(await fs.pathExists(qualityReportPath))
		)
	) {
		runCommand(
			process.execPath,
			["src/scripts/produce_byosan_feature.ts", specPath],
			{
				...process.env,
				...byosanFontconfigEnv(),
				ENV_FILE: "config/.env.byosan",
				YOUTUBE_CHANNEL_PROFILE: "byosan",
			},
		);
		checkpoint.stages.media_ready = true;
		const qualityReport = (await fs.readJson(qualityReportPath)) as {
			decision?: string;
		};
		checkpoint.stages.quality_pass = qualityReport.decision === "PASS";
		writeByosanCheckpoint(store.runDir, checkpoint);
	}
	if (!checkpoint.stages.quality_pass) {
		throw new Error(`QUALITY_GATE_FAILED: ${qualityReportPath}`);
	}
	runCommand(
		process.execPath,
		["src/scripts/audit_byosan_authenticity.ts", "--run", runId],
		process.env,
	);
	writeByosanCanonicalAudit(store.runDir, spec, inputSourceText(input));
	markFailureRecovered(store.runDir);
	console.log(`PRODUCTION_PASS=${runId}`);
}

if (import.meta.main) {
	runByosanDaily().catch((error) => {
		const failureDate = process.env.BYOSAN_DATE?.trim() || getRunIdDateString();
		const failureRunDir = path.join(
			ROOT,
			"runs",
			"byosan_money",
			`${failureDate}-daily${process.env.BYOSAN_SUFFIX ?? ""}`,
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
