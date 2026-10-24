import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import { type ResearchResult, TrendScout } from "../domain/agents/research.js";
import type { ByosanActiveProbeEvidence } from "../domain/byosan/active_probe.js";
import {
	reconcileByosanCheckpoint,
	writeByosanCheckpoint,
} from "../domain/byosan/checkpoint.js";
import {
	type StructuredCall,
	byosanLlmConfig,
	codexLlmLogPath,
	invokeCodexStructured,
	llmBackend,
	structuredRequest,
} from "../domain/byosan/codex_llm.js";
import { selectByosanEditorialReferencePlan } from "../domain/byosan/editorial_references.js";
import {
	type ExplainConfig,
	type Explanation,
	ExplanationArticlesSchema,
	buildExplanationEvidence,
	runCodexExplanation,
} from "../domain/byosan/explanation.js";
import {
	type FeatureDraftContext,
	type Json,
	buildFeatureSpecInput,
	featureDraftIssues,
	featureRepairMessages,
	featureUnitSchema,
	isJson,
	isLocallyRepairable,
	normalizeFeatureDraft,
	repairFeatureDraftLocally,
	summarizeFeatureIssues,
} from "../domain/byosan/feature_repair.js";
import {
	ByosanFeatureDraftSchema,
	type ByosanFeatureSource,
	type ByosanFeatureSpec,
	type FeatureSpecIssue,
	archetypeSlotPromptPolicy,
	parseAndAuditByosanFeatureSpec,
} from "../domain/byosan/feature_spec.js";
import {
	type DiscoveryConfig,
	writeDiscoveryEvidence,
} from "../domain/byosan/feed_discovery.js";
import {
	type ByosanAdversarialEvidence,
	type ByosanAngleCandidate,
	type ByosanProductionPlan,
	isCurrentByosanAngleDecision,
	selectByosanProductionPlan,
} from "../domain/byosan/news_angle.js";
import { loadPreferredByosanFormat } from "../domain/byosan/performance.js";
import {
	AssetStore,
	ROOT,
	getRunIdDateString,
	invokeStructuredLlm,
	loadConfig,
	zodSizeConstraintLines,
} from "../io/core.js";
import {
	type ByosanPreflightReport,
	runByosanPreflight,
} from "./byosan_preflight.js";

type FeatureSource = ByosanFeatureSource;

const FEATURE_DRAFT_SIZE_LIMITS = zodSizeConstraintLines(
	ByosanFeatureDraftSchema,
).join("\n");

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
	| "RESEARCH_ANGLE_STOP"
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

export const REPAIR_VALIDATION_COMMAND = "task check:merge";

export type RepairResolution = {
	status: "VERIFIED";
	root_cause: string;
	regression_test: string;
	repair_commit: string;
	validation: {
		command: typeof REPAIR_VALIDATION_COMMAND;
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
	resolution_history?: ResolvedFailure[];
};

type ResolvedFailure = {
	fingerprint: string;
	failure_class: ByosanFailureClass;
	resolution: RepairResolution;
};

function safeSourceId(raw: string, index: number): string {
	const normalized = raw
		.normalize("NFKD")
		.replaceAll(/[^a-zA-Z0-9_-]+/g, "_")
		.replaceAll(/^_+|_+$/g, "")
		.slice(0, 48);
	return normalized || `source_${index + 1}`;
}

export function normalizedResearchEvidence(candidate: ByosanAngleCandidate): {
	sources: FeatureSource[];
	adversarialEvidence: ByosanAdversarialEvidence[];
	activeProbes: ByosanActiveProbeEvidence[];
} {
	const seen = new Set<string>();
	const sourceIdMap = new Map<string, string>();
	const sources = candidate.sources.map((source, index) => {
		let id = safeSourceId(source.id, index);
		while (seen.has(id)) id = `${id}_${index + 1}`;
		seen.add(id);
		sourceIdMap.set(source.id, id);
		return { id, name: source.name, url: source.url, tier: source.tier };
	});
	const remapIds = (sourceIds: string[]): string[] =>
		sourceIds.map((sourceId) => {
			const mapped = sourceIdMap.get(sourceId);
			if (!mapped) {
				throw new Error(
					`BYOSAN_ADVERSARIAL_EVIDENCE_SOURCE_MISSING: ${sourceId}`,
				);
			}
			return mapped;
		});
	return {
		sources,
		adversarialEvidence: candidate.adversarialEvidence.map((evidence) => ({
			...evidence,
			sourceIds: remapIds(evidence.sourceIds),
			checkedSourceIds: remapIds(evidence.checkedSourceIds),
		})),
		activeProbes: (candidate.activeProbes ?? []).map((probe) => ({
			...probe,
			sourceIds: remapIds(probe.sourceIds),
		})),
	};
}

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

export function classifyByosanFailure(message: string): {
	failureClass: ByosanFailureClass;
	stage: ByosanFailureStage;
	retryPolicy: RetryPolicy;
	maxRetries: number;
} {
	const stage = failureStage(message);
	if (/BYOSAN_ANGLE_STOP/.test(message)) {
		return {
			failureClass: "RESEARCH_ANGLE_STOP",
			stage: "RESEARCH",
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
	if (
		/BYOSAN_PREFLIGHT_BLOCKED/.test(message) &&
		!/429|rate limit|quota exhausted|resource exhausted/i.test(message)
	) {
		if (
			/\b(python_runtime|ffmpeg|ffprobe|voicevox) (FAIL|UNVERIFIED)/.test(
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
			failureClass: "NETWORK_AUTH",
			stage,
			retryPolicy: "REQUIRES_REPAIR_EVIDENCE",
			maxRetries: 0,
		};
	}
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
	if (/schema|zod|invalid_type|structured output|parse/i.test(message)) {
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
	if (/PUBLISH_|\byoutube\b/i.test(message)) {
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

export function reusableResearchResult(
	cached: ResearchResult,
): ResearchResult | undefined {
	return isCurrentByosanAngleDecision(cached.angle_decision)
		? cached
		: undefined;
}

export function preflightBlockedMessage(
	report: ByosanPreflightReport,
	reportPath: string,
): string {
	const failed = Object.values(report.checks)
		.filter((check) => check.status !== "PASS")
		.map((check) => `${check.component} ${check.status}: ${check.reason}`);
	return `BYOSAN_PREFLIGHT_BLOCKED: ${report.status} ${reportPath} ${failed.join("; ")}`;
}

export function repairResolutionIsValid(
	resolution: RepairResolution | undefined,
	currentHead: string,
): boolean {
	return Boolean(
		resolution?.status === "VERIFIED" &&
			resolution.root_cause.trim() &&
			resolution.regression_test.trim() &&
			resolution.regression_test !== "pending" &&
			resolution.repair_commit === currentHead &&
			resolution.validation.command === REPAIR_VALIDATION_COMMAND &&
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
	const sameFailure = previous?.fingerprint === fingerprint;
	const resolutionHistory = [
		...(previous?.resolution_history ?? []),
		...(previous?.resolution && !sameFailure
			? [
					{
						fingerprint: previous.fingerprint,
						failure_class: previous.failure_class,
						resolution: previous.resolution,
					},
				]
			: []),
	];
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
		first_failed_at: sameFailure ? previous.first_failed_at : now,
		...(sameFailure && previous.resolution
			? { resolution: previous.resolution }
			: {}),
		...(resolutionHistory.length > 0
			? { resolution_history: resolutionHistory }
			: {}),
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

export function selectedCandidate(
	research: ResearchResult,
): ByosanAngleCandidate {
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

export async function generateFeatureSpec(
	research: ResearchResult,
	candidate: ByosanAngleCandidate,
	productionPlan: ByosanProductionPlan,
	explanation: Explanation,
	sources: FeatureSource[],
	adversarialEvidence: ByosanAdversarialEvidence[],
	activeProbes: ByosanActiveProbeEvidence[],
	runDir: string,
	runId: string,
	date: string,
): Promise<ByosanFeatureSpec> {
	const titleRule = (
		loadConfig("byosan_money") as unknown as {
			discovery: DiscoveryConfig;
		}
	).discovery.title_rule;
	const bannedPhrases = (
		loadConfig("byosan_money") as unknown as { explain: ExplainConfig }
	).explain.banned_conclusion_phrases;
	const hookPromises = candidate.numbers.slice(0, 4);
	if (hookPromises.length < 2) {
		throw new Error(
			"BYOSAN_FEATURE_GENERATION_FAILED: at least two hook promises are required",
		);
	}
	const editorialReferencePlan = selectByosanEditorialReferencePlan(
		runId,
		candidate.angle,
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "editorial_reference_plan.json"),
		editorialReferencePlan,
		{ spaces: 2 },
	);
	const llm = byosanLlmConfig();
	const context: FeatureDraftContext = {
		runId,
		asOf: date,
		angle: candidate.angle,
		searchQuery: research.director_data.search_query,
		production: productionPlan,
		editorialReferencePlan,
		narrative: {
			hiddenMechanism: candidate.hiddenMechanism,
			counterfactual: candidate.counterfactual,
			audiencePayoff: candidate.audiencePayoff,
		},
		adversarialEvidence,
		activeProbes,
		sources,
		explanation,
		candidateNumbers: candidate.numbers,
		bannedPhrases,
	};
	const invokeFeature = <T, U>(request: StructuredCall<T, U>): Promise<U> =>
		llmBackend(llm, "feature") === "codex"
			? invokeCodexStructured({
					llm,
					logPath: codexLlmLogPath(runDir),
					...request,
				})
			: invokeStructuredLlm({
					...request,
					llmOptions: { temperature: 0.28, sessionId: runDir },
				});
	const request = structuredRequest({
		maxAttempts: llm.max_attempts,
		schema: z.unknown(),
		providerSchema: ByosanFeatureDraftSchema,
		name: "byosan_feature_draft",
		evidencePath: path.join(
			runDir,
			"audit",
			"structured_feature_attempts.json",
		),
		messages: (attempt, lastValidationError) => [
			{
				role: "system",
				content: `あなたは秒算マネーの編集長です。与えられた証拠だけで対話型金融動画を設計します。production_planは固定契約で、format=${productionPlan.format}、target=${productionPlan.targetMinutes}分、segments=目安${productionPlan.minSegments}〜${productionPlan.maxSegments}です。出典にない数字や断定を作らないでください。推計はderived_with_caveatまたはanalyst_estimate_not_company_non_gaapとし、必ずcaveat、confidence(0.0〜1.0)、unresolvedMismatchesを付けます。unresolvedMismatchesは確認済みでmaterialな矛盾がなければ空配列、残る矛盾があれば具体文を入れます。非verified claimは台詞に「推論」「推定」「分析」のいずれかの区別語を含めて発話します。claimsには一意なidを付け、sourceIdsにはallowed_sourcesのidだけを使います。allowed_sourcesのtier=L3だけで支えるclaimは、第三者検証済みと誤認させないepistemicBoundaryを短い自然文で必ず付け、その文をresolutionまたはlanding segmentのtextに完全一致で含めます。packaging.primaryClaimId/claimIdsはclaims.idだけを参照し、タイトル・サムネイルの数字と強い比較表現をそのclaimsで根拠付けます。【速報】はproduction_plan.format=breakingかつcandidate.sourcesのevent dateがasOfから2日以内の場合だけ使います。最大・最安・最高・最低・急騰・急落・崩壊・〜級などを使う場合はpackaging.relativeAnchorにclaimId/comparator/periodを必ず入れます。冒頭2シーンでhookPromisesのうち1つ以上に触れます。各segmentにはnarrativeRoleとverificationRoleを付けます。packaging.claimIdsの主張について、別話者のauditorとresolutionをそれぞれ1つ以上置きます。固定の順序は要求しません。presenterはsource-backed factを提示しclaimIdsで参照します。auditorは別話者が担当し、同じclaimIdとadversarial_evidence.idをevidenceIdsで参照して、測定条件・負け筋・比較基準・出所境界のいずれかを具体的に問いただします。単なる相槌は禁止です。resolutionは同じclaimIdと同じevidenceIdを参照してcounter-evidence/condition/caveatを回収します。landingは同じclaimIdを参照し、確認済み・推定・未検証を混同せず影響へ着地します。反証として挙がった論点は、必要な範囲でresolutionに含めてください。春日部つむぎとずんだもんの対話、statsの件数は後述のスキーマ由来の制約に従い、発話で提示する根拠のある数値カードだけを入れます。数値カードを示さない問い・つなぎ・結論のシーンではstatsを空配列にし、件数を埋めるための数字やカードを作らないでください。画面は中心固定で、左右揺れを前提にしたvisualPlanを書かないでください。editorial_reference_planは構成・図解・字幕・画面転換・サムネの分解計画で、事実根拠ではありません。そのためclaims.sourceIdsにはeditorial_reference_planのreferenceIdを使わず、計画を内容へ翻訳し、サイト名の模倣・ロゴ・固有文言・素材転載はしないでください。毎回新しい比較単位、章構成、問いの順番を選びます。explanationの結論・原理・数字を台本の骨格にし、順序は conclusion→数字→principle→check→出典の順にします。explanationのfiguresの各valueの数値と単位（例: 2.4%）を、segmentsのtextかstats.valueのいずれかに含めます。${titleRule}`,
			},
			{
				role: "user",
				content: `対象証拠:\n${JSON.stringify(
					{
						candidate,
						hook_promises: hookPromises,
						production_plan: productionPlan,
						explanation,
						editorial_reference_plan: editorialReferencePlan,
						allowed_sources: sources,
						adversarial_evidence: adversarialEvidence,
						active_probes: activeProbes,
						news: research.news,
					},
					null,
					2,
				)}\n\n制約（ByosanFeatureDraftSchema から導出した文字数・件数の上限と下限。下記の全項目を守る）:\n${FEATURE_DRAFT_SIZE_LIMITS}\n${archetypeSlotPromptPolicy(productionPlan.narrativeArchetype)}\nthumbnailTitleとthumbnailは同じmaterial claimを表す。冒頭2シーンのclaimIdsには packaging.primaryClaimId を必ず含め、titleとサムネイルはそのprimaryClaimIdの主張を指します。タイトル・サムネイルに出す数値はpackaging.claimIdsが参照するclaims.claim本文にも同じ数値を含める。hookPromisesは candidate.numbers のいずれかの原文から、数値を含む連続した部分を24文字以内で2〜4個抜き出す（各要素は原文の部分文字列であること）。noveltyQueriesはYouTube上の完全一致・類似角度を点検できる検索式にする。descriptionBulletsは重要な限定条件を3〜8件含める。segmentsは目安${productionPlan.minSegments}〜${productionPlan.maxSegments}件。attempt=${attempt}\n前回の検証エラー: ${lastValidationError ?? "なし"}`,
			},
		],
		validate: (rawDraft) => {
			if (!isJson(rawDraft)) {
				throw new Error(
					"BYOSAN_FEATURE_DRAFT_INVALID: draft must be a JSON object",
				);
			}
			const normalized = normalizeFeatureDraft(rawDraft, sources);
			const globalIssues = featureDraftIssues(normalized.draft, context).filter(
				(issue) => !isLocallyRepairable(issue.path),
			);
			if (globalIssues.length > 0) {
				throw new Error(
					`BYOSAN_FEATURE_DRAFT_INVALID: ${summarizeFeatureIssues(globalIssues)}`,
				);
			}
			return normalized;
		},
	});
	const first = await invokeFeature(request);
	const repairUnit = async (
		unit: string,
		issues: FeatureSpecIssue[],
		draft: Json,
	): Promise<unknown> => {
		const unitSchema = featureUnitSchema(unit);
		if (unitSchema === undefined) {
			throw new Error(`BYOSAN_FEATURE_UNIT_NOT_REPAIRABLE: ${unit}`);
		}
		const result = await invokeFeature(
			structuredRequest({
				maxAttempts: llm.max_attempts,
				schema: z.object({ value: z.unknown() }),
				providerSchema: z.object({ value: unitSchema }),
				name: "byosan_feature_repair",
				messages: () =>
					featureRepairMessages({
						unit,
						issues,
						draft,
						context,
						constraintLines: FEATURE_DRAFT_SIZE_LIMITS,
					}),
			}),
		);
		return result.value;
	};
	const repaired = await repairFeatureDraftLocally({
		draft: first.draft,
		sources,
		maxRepairs: llm.max_local_repairs,
		check: (draft) => featureDraftIssues(draft, context),
		repairUnit,
	});
	fs.outputJsonSync(
		path.join(runDir, "audit", "feature_repair.json"),
		{
			schemaVersion: "byosan_feature_repair_v1",
			corrections: [...first.corrections, ...repaired.corrections],
			rounds: repaired.rounds,
		},
		{ spaces: 2 },
	);
	return parseAndAuditByosanFeatureSpec(
		buildFeatureSpecInput(
			ByosanFeatureDraftSchema.parse(repaired.draft),
			context,
		),
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
	const checkpoint = reconcileByosanCheckpoint(store.runDir, runId, ROOT);
	writeByosanCheckpoint(store.runDir, checkpoint);
	const preflight = await runByosanPreflight(store.runDir);
	if (preflight.status !== "PASS") {
		throw new Error(
			preflightBlockedMessage(
				preflight,
				path.join(store.runDir, "audit", "preflight.json"),
			),
		);
	}
	assertByosanRetryAllowed(store.runDir);
	const researchPath = path.join(
		store.runDir,
		"source",
		"research_result.json",
	);
	const cachedResearch =
		checkpoint.stages.research_ready && (await fs.pathExists(researchPath))
			? ((await fs.readJson(researchPath)) as ResearchResult)
			: undefined;
	const reusedResearch =
		cachedResearch && reusableResearchResult(cachedResearch);
	let research: ResearchResult;
	if (reusedResearch) {
		research = reusedResearch;
	} else {
		const llm = byosanLlmConfig();
		const scout =
			llmBackend(llm, "research") === "codex"
				? new TrendScout(store, (request) =>
						invokeCodexStructured({
							llm,
							logPath: codexLlmLogPath(store.runDir),
							...request,
						}),
					)
				: new TrendScout(store);
		const discovery = loadConfig("byosan_money") as unknown as {
			discovery: DiscoveryConfig;
		};
		const evidence = await writeDiscoveryEvidence(
			discovery.discovery,
			store.runDir,
			new Date(),
		);
		research = await scout.run("byosan_money", 5, evidence);
		await fs.outputJson(researchPath, research, { spaces: 2 });
		checkpoint.stages.research_ready = true;
		writeByosanCheckpoint(store.runDir, checkpoint);
	}
	const candidate = selectedCandidate(research);
	const selectedIndex = research.angle_decision?.selectedIndex;
	const evaluated =
		selectedIndex === null || selectedIndex === undefined
			? undefined
			: research.angle_decision?.evaluated[selectedIndex];
	if (!evaluated) {
		throw new Error("BYOSAN_ANGLE_STOP: selected evaluation is missing");
	}
	const preferredFormat = loadPreferredByosanFormat(ROOT);
	const productionPlan = selectByosanProductionPlan(
		evaluated,
		date,
		preferredFormat,
	);
	const normalized = normalizedResearchEvidence(candidate);
	const specPath = path.join(store.runDir, "source", "feature_spec.json");
	let spec: ByosanFeatureSpec;
	if (checkpoint.stages.spec_ready && (await fs.pathExists(specPath))) {
		spec = parseAndAuditByosanFeatureSpec(await fs.readJson(specPath));
	} else {
		const explainConfig = (
			loadConfig("byosan_money") as unknown as { explain: ExplainConfig }
		).explain;
		const discoveredArticles = ExplanationArticlesSchema.parse(
			await fs.readJson(
				path.join(store.runDir, "research", "discovery_articles.json"),
			),
		);
		const explanation = runCodexExplanation(
			explainConfig,
			buildExplanationEvidence(candidate, discoveredArticles),
			store.runDir,
		);
		await fs.outputJson(
			path.join(store.runDir, "source", "explanation.json"),
			explanation,
			{ spaces: 2 },
		);
		spec = await generateFeatureSpec(
			research,
			candidate,
			productionPlan,
			explanation,
			normalized.sources,
			normalized.adversarialEvidence,
			normalized.activeProbes,
			store.runDir,
			runId,
			date,
		);
		await fs.outputJson(specPath, spec, { spaces: 2 });
		checkpoint.stages.spec_ready = true;
		writeByosanCheckpoint(store.runDir, checkpoint);
	}
	await fs.outputJson(
		path.join(store.runDir, "audit", "loop_manifest.json"),
		{
			execution_layer: "agent loop",
			validation_layer: "closed-loop agent workflow",
			improvement_layer: "agent improvement loop / harness design",
			angle_decision: research.angle_decision,
			production_plan: productionPlan,
			performance_preference: preferredFormat ?? null,
			feature_spec: specPath,
			motion_policy: "static_scenes_no_camera_motion",
			generated_at: new Date().toISOString(),
		},
		{ spaces: 2 },
	);

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
