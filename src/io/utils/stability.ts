import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";

export type FailureDisposition =
	| "success"
	| "retryable"
	| "skipped"
	| "pending"
	| "blocked"
	| "fatal";

export interface FailureClassification {
	disposition: FailureDisposition;
	category: string;
	retryable: boolean;
	matchedRule: string;
	message: string;
}

export interface RunEvidence {
	run_id: string;
	bucket: string;
	status: string;
	disposition: FailureDisposition;
	log_path: string;
	evidence_paths: string[];
	artifact_paths: string[];
	public_url?: string;
	failure?: FailureClassification;
	note?: string;
	recorded_at: string;
	config_hash?: string;
	prompt_hash?: string;
	autonomy_attribution?: string;
	thumbnail_iqa?: number;
	thumbnail_continuity?: number;
}

export const STABILITY_BUCKETS = [
	"byosan_money",
	"humanity_observatory",
	"yawa_archive",
] as const;

export function findRunDirsForDate(bucket: string, date: string): string[] {
	const bucketDir = path.join(process.cwd(), "runs", bucket);
	if (!fs.existsSync(bucketDir)) return [];
	return fs
		.readdirSync(bucketDir)
		.map((name) => path.join(bucketDir, name))
		.filter((entry) => {
			if (!fs.statSync(entry).isDirectory()) return false;
			const runName = path.basename(entry);
			return runName === date || runName.startsWith(`${date}-`);
		})
		.sort((a, b) => {
			const aName = path.basename(a);
			const bName = path.basename(b);
			if (aName === date && bName !== date) return -1;
			if (bName === date && aName !== date) return 1;
			return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
		});
}

export function findRunDirForDate(bucket: string, date: string): string {
	return (
		findRunDirsForDate(bucket, date)[0] ||
		path.join(process.cwd(), "runs", bucket, date)
	);
}

type Rule = {
	patterns: RegExp[];
	disposition: Exclude<FailureDisposition, "success">;
	category: string;
	retryable: boolean;
	matchedRule: string;
};

const RULES: Rule[] = [
	{
		patterns: [/429/, /rate limit/i, /quota/i, /too many requests/i],
		disposition: "retryable",
		category: "quota_or_rate_limit",
		retryable: true,
		matchedRule: "rate_limit_or_quota",
	},
	{
		patterns: [/CRITICAL: LLM invocation failed after \d+ attempts/i],
		disposition: "retryable",
		category: "llm_exhaustion",
		retryable: true,
		matchedRule: "llm_exhaustion",
	},
	{
		patterns: [
			/Failed to generate a script passing integrity audits after \d+ attempts/i,
		],
		disposition: "fatal",
		category: "script_integrity",
		retryable: false,
		matchedRule: "script_integrity_failure",
	},
	{
		patterns: [/JSON Parse error:/i],
		disposition: "pending",
		category: "parse_error",
		retryable: true,
		matchedRule: "json_parse_error",
	},
	{
		patterns: [
			/publish blocked/i,
			/PUBLISH_BLOCKED/,
			/bucket .* does not match/i,
		],
		disposition: "blocked",
		category: "publish_blocked",
		retryable: false,
		matchedRule: "publish_blocked",
	},
	{
		patterns: [/permission denied/i, /EACCES/i, /EPERM/i],
		disposition: "blocked",
		category: "permission",
		retryable: false,
		matchedRule: "permission_error",
	},
	{
		patterns: [/ENOENT/i, /no such file or directory/i, /missing/i],
		disposition: "pending",
		category: "missing_artifact",
		retryable: true,
		matchedRule: "missing_artifact",
	},
	{
		patterns: [/timeout/i, /timed out/i, /wait.*failed/i],
		disposition: "pending",
		category: "timeout_or_wait",
		retryable: true,
		matchedRule: "timeout_or_wait",
	},
	{
		patterns: [/skip/i, /skipping/i],
		disposition: "skipped",
		category: "skipped",
		retryable: false,
		matchedRule: "explicit_skip",
	},
];

export function classifyFailureMessage(message: string): FailureClassification {
	const normalized = message.trim() || "Unknown failure";
	for (const rule of RULES) {
		if (rule.patterns.some((pattern) => pattern.test(normalized))) {
			return {
				disposition: rule.disposition,
				category: rule.category,
				retryable: rule.retryable,
				matchedRule: rule.matchedRule,
				message: normalized,
			};
		}
	}
	return {
		disposition: "fatal",
		category: "fatal",
		retryable: false,
		matchedRule: "default_fatal",
		message: normalized,
	};
}

export function resolveDailyLogPath(runId?: string): string {
	const date =
		runId?.split("/").pop() ||
		new Intl.DateTimeFormat("en-CA", {
			timeZone: "Asia/Tokyo",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(new Date());
	return path.join(process.cwd(), "logs", "daily", `${date}.log`);
}

function resolveConfigPath(bucket: string): string | undefined {
	const configured = process.env.CONFIG_PATH;
	if (configured && fs.existsSync(configured)) return configured;
	const domainPath = path.join(
		process.cwd(),
		"config",
		"domains",
		`${bucket}.yaml`,
	);
	return fs.existsSync(domainPath) ? domainPath : undefined;
}

function computeConfigHash(bucket: string): string {
	const configPath = resolveConfigPath(bucket);
	if (!configPath) return "unknown_config_hash";
	try {
		return crypto
			.createHash("sha256")
			.update(fs.readFileSync(configPath))
			.digest("hex");
	} catch {
		return "unknown_config_hash";
	}
}

function computePromptHash(bucket: string): string {
	const configPath = resolveConfigPath(bucket);
	if (!configPath) return "unknown_prompt_hash";
	try {
		const parsed = yaml.load(fs.readFileSync(configPath, "utf-8")) as Record<
			string,
			unknown
		>;
		if (!parsed?.prompts) return "unknown_prompt_hash";
		return crypto
			.createHash("sha256")
			.update(JSON.stringify(parsed.prompts))
			.digest("hex");
	} catch {
		return "unknown_prompt_hash";
	}
}

function resolveThumbnailContinuity(runDir: string): number | undefined {
	const resultPath = path.join(runDir, "audit", "result.json");
	if (!fs.existsSync(resultPath)) return undefined;
	try {
		const results = fs.readJsonSync(resultPath);
		if (results.audience_thumbnail_continuity) {
			const details = results.audience_thumbnail_continuity.details || "";
			const match = details.match(/Score:\s*(\d+)/);
			if (match) return Number(match[1]);
			if (results.audience_thumbnail_continuity.status === "PASS") return 100;
			if (results.audience_thumbnail_continuity.status === "FAIL") return 50;
		}
		if (results.det_thumbnail_continuity) {
			if (results.det_thumbnail_continuity.status === "PASS") return 100;
			const details = results.det_thumbnail_continuity.details || "";
			if (details.includes("Missing:")) {
				const missingCount = details
					.replace("Missing:", "")
					.split(",")
					.filter(Boolean).length;
				return Math.max(0, 100 - missingCount * 20);
			}
			return 0;
		}
	} catch {}
	return undefined;
}

export function writeRunEvidence(
	runDir: string,
	evidence: Omit<RunEvidence, "recorded_at"> & { recorded_at?: string },
): string {
	const configHash = evidence.config_hash || computeConfigHash(evidence.bucket);
	const promptHash = evidence.prompt_hash || computePromptHash(evidence.bucket);
	let finalNote = evidence.note || "";
	if (!evidence.config_hash || !evidence.prompt_hash) {
		const gaps: string[] = [];
		if (!evidence.config_hash) gaps.push("config_hash");
		if (!evidence.prompt_hash) gaps.push("prompt_hash");
		const gap = `[Gap Note: ${gaps.join(" and ")} not explicitly supplied by call site, computed hashes used]`;
		finalNote = finalNote ? `${gap} ${finalNote}` : gap;
	}

	let autonomy = evidence.autonomy_attribution || process.env.AUTONOMY_TRIGGER;
	if (!autonomy) {
		autonomy = fs.existsSync(path.join(runDir, "run_evidence.json"))
			? "retry"
			: "manual";
	}

	let thumbnailIqa = evidence.thumbnail_iqa;
	if (thumbnailIqa === undefined) {
		const iqaReportPath = path.join(runDir, "audit", "iqa_report.json");
		if (fs.existsSync(iqaReportPath)) {
			try {
				const iqa = fs.readJsonSync(iqaReportPath);
				if (iqa && typeof iqa.score === "number") {
					thumbnailIqa = Math.round(iqa.score * 100);
				}
			} catch {}
		}
	}

	const payload: RunEvidence = {
		...evidence,
		recorded_at: evidence.recorded_at || new Date().toISOString(),
		config_hash: configHash,
		prompt_hash: promptHash,
		autonomy_attribution: autonomy,
		note: finalNote,
		thumbnail_iqa: thumbnailIqa,
		thumbnail_continuity:
			evidence.thumbnail_continuity ?? resolveThumbnailContinuity(runDir),
	};
	if (!payload.public_url) {
		const receiptPath = path.join(runDir, "publish", "receipt.json");
		const statePath = path.join(runDir, "publish", "state.json");
		if (fs.existsSync(receiptPath) && fs.existsSync(statePath)) {
			try {
				const receipt = fs.readJsonSync(receiptPath) as {
					youtube?: { video_id?: string };
				};
				const publication = fs.readJsonSync(statePath) as {
					phase?: string;
					video_id?: string;
				};
				const videoId = receipt.youtube?.video_id;
				if (
					videoId &&
					publication.phase === "VERIFIED" &&
					publication.video_id === videoId
				) {
					payload.public_url = `https://www.youtube.com/watch?v=${videoId}`;
				}
			} catch {}
		}
	}
	const target = path.join(runDir, "run_evidence.json");
	fs.ensureDirSync(path.dirname(target));
	fs.writeJsonSync(target, payload, { spaces: 2 });
	console.log(`[AUTONOMY] trigger=${payload.autonomy_attribution}`);
	return target;
}

export function isEvidenceReady(runDir: string): boolean {
	const evidencePath = path.join(runDir, "run_evidence.json");
	if (!fs.existsSync(evidencePath)) return false;
	try {
		const evidence = fs.readJsonSync(evidencePath) as RunEvidence;
		if (evidence.disposition !== "success" || !evidence.public_url) return false;
		const receiptPath = path.join(runDir, "publish", "receipt.json");
		const publicationPath = path.join(runDir, "publish", "state.json");
		if (!fs.existsSync(receiptPath) || !fs.existsSync(publicationPath)) return false;
		const receipt = fs.readJsonSync(receiptPath) as {
			youtube?: { video_id?: string };
		};
		const publication = fs.readJsonSync(publicationPath) as {
			phase?: string;
			video_id?: string;
		};
		if (
			!receipt.youtube?.video_id ||
			publication.phase !== "VERIFIED" ||
			publication.video_id !== receipt.youtube.video_id
		) {
			return false;
		}
		if (!fs.existsSync(path.join(runDir, "media", "video", "video.mp4"))) {
			return false;
		}
		if (!fs.existsSync(path.join(runDir, "research.json"))) return false;
		const auditReportPath = path.join(runDir, "audit", "report.json");
		if (!fs.existsSync(auditReportPath)) return false;
		return fs.readJsonSync(auditReportPath)?.decision === "PASS";
	} catch {
		return false;
	}
}

export function getMissingEvidence(runDir: string): string[] {
	const missing: string[] = [];
	const evidencePath = path.join(runDir, "run_evidence.json");
	if (!fs.existsSync(evidencePath)) return ["run_evidence.json"];
	try {
		const evidence = fs.readJsonSync(evidencePath) as RunEvidence;
		if (evidence.disposition !== "success") {
			missing.push(`evidence disposition=${evidence.disposition}`);
		}
		if (!evidence.public_url) missing.push("evidence public_url");
	} catch {
		return ["run_evidence.json (invalid JSON)"];
	}

	const receiptPath = path.join(runDir, "publish", "receipt.json");
	const publicationPath = path.join(runDir, "publish", "state.json");
	if (!fs.existsSync(receiptPath)) missing.push("publish/receipt.json");
	if (!fs.existsSync(publicationPath)) missing.push("publish/state.json");
	if (
		!fs.existsSync(path.join(runDir, "media", "video", "video.mp4"))
	) {
		missing.push("media/video/video.mp4");
	}
	if (!fs.existsSync(path.join(runDir, "research.json"))) {
		missing.push("research.json");
	}
	const auditReportPath = path.join(runDir, "audit", "report.json");
	if (!fs.existsSync(auditReportPath)) {
		missing.push("audit/report.json");
	} else {
		try {
			const auditReport = fs.readJsonSync(auditReportPath) as {
				decision?: string;
			};
			if (auditReport.decision !== "PASS") {
				missing.push(`audit failed (decision=${auditReport.decision})`);
			}
		} catch {
			missing.push("audit/report.json (invalid JSON)");
		}
	}
	return missing;
}

export type PublishedChannelUrl = {
	channel_label: string;
	channel_title: string;
	channel_id?: string;
	run_id: string;
	proof_path: string;
	public_url: string;
	published_at?: string;
};

type PublishedChannelUrlCandidate = PublishedChannelUrl & {
	source_mtime_ms: number;
};

function resolveChannelLabel(
	channelId?: string,
	channelTitle?: string,
): string | undefined {
	if (channelId === "UCYtjO-PYBfdG3MuPLXfhA-Q") return "秒算マネー";
	if (channelId === "UCMDrWHL4Jc6gtmfoqaW7sxg") return "人類観測所";
	if (channelTitle?.includes("秒算マネー")) return "秒算マネー";
	if (channelTitle?.includes("人類観測所")) return "人類観測所";
	if (channelTitle?.includes("夜話アーカイブ")) return "夜話アーカイブ";
	return undefined;
}

async function isAccessibleYouTubeUrl(publicUrl: string): Promise<boolean> {
	try {
		const response = await fetch(
			`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(publicUrl)}`,
			{ redirect: "follow" },
		);
		return response.ok;
	} catch {
		return false;
	}
}

function resolveChannelTitle(
	bucketName: string,
	channelTitle?: string,
): string {
	if (channelTitle) return channelTitle;
	switch (bucketName) {
		case "byosan_money":
			return "秒算マネー";
		case "humanity_observatory":
			return "雨晴はうの人類観測所";
		case "yawa_archive":
			return "夜話アーカイブ ASMR";
		default:
			return bucketName;
	}
}

export async function getLatestPublishedChannelUrls(): Promise<
	PublishedChannelUrl[]
> {
	const runsRoot = path.join(process.cwd(), "runs");
	if (!fs.existsSync(runsRoot)) return [];
	const candidates: PublishedChannelUrlCandidate[] = [];
	for (const bucketName of fs.readdirSync(runsRoot)) {
		const bucketDir = path.join(runsRoot, bucketName);
		if (!fs.statSync(bucketDir).isDirectory()) continue;
		for (const runName of fs.readdirSync(bucketDir)) {
			const runDir = path.join(bucketDir, runName);
			if (!fs.statSync(runDir).isDirectory()) continue;
			const statePath = path.join(runDir, "publish", "state.json");
			const receiptPath = path.join(runDir, "publish", "receipt.json");
			if (!fs.existsSync(statePath) || !fs.existsSync(receiptPath)) continue;
			try {
				const publication = fs.readJsonSync(statePath) as {
					phase?: string;
					video_id?: string;
				};
				const receipt = fs.readJsonSync(receiptPath) as {
					youtube?: {
						video_id?: string;
						channel_id?: string;
						channel_title?: string;
						published_at?: string;
					};
				};
				const youtube = receipt.youtube;
				if (
					publication.phase !== "VERIFIED" ||
					!youtube?.video_id ||
					publication.video_id !== youtube.video_id
				) {
					continue;
				}
				const channelLabel = resolveChannelLabel(
					youtube.channel_id,
					youtube.channel_title,
				);
				if (!channelLabel) continue;
				candidates.push({
					channel_label: channelLabel,
					channel_title: resolveChannelTitle(bucketName, youtube.channel_title),
					channel_id: youtube.channel_id,
					run_id: `${bucketName}/${runName}`,
					proof_path: receiptPath,
					public_url: `https://www.youtube.com/watch?v=${youtube.video_id}`,
					published_at: youtube.published_at,
					source_mtime_ms: fs.statSync(receiptPath).mtimeMs,
				});
			} catch {}
		}
	}

	const accessibleCandidates: PublishedChannelUrlCandidate[] = [];
	for (const candidate of candidates) {
		if (await isAccessibleYouTubeUrl(candidate.public_url)) {
			accessibleCandidates.push(candidate);
		}
	}
	const byChannel = new Map<string, PublishedChannelUrlCandidate>();
	for (const candidate of accessibleCandidates) {
		const existing = byChannel.get(candidate.channel_label);
		if (!existing) {
			byChannel.set(candidate.channel_label, candidate);
			continue;
		}
		const existingTime = existing.published_at
			? Date.parse(existing.published_at)
			: existing.source_mtime_ms;
		const candidateTime = candidate.published_at
			? Date.parse(candidate.published_at)
			: candidate.source_mtime_ms;
		if (candidateTime >= existingTime) {
			byChannel.set(candidate.channel_label, candidate);
		}
	}
	return [...byChannel.values()]
		.sort((a, b) => a.channel_label.localeCompare(b.channel_label, "ja"))
		.map(({ source_mtime_ms: _sourceMtimeMs, ...rest }) => rest);
}

export function classifyLogText(logText: string): {
	status: FailureDisposition;
	failure?: FailureClassification;
	terminal_line: string;
} {
	const lines = logText.split(/\r?\n/).filter(Boolean);
	let terminalLine = "";
	let status: FailureDisposition = "pending";
	let failure: FailureClassification | undefined;
	for (const line of lines) {
		if (
			line.includes("PUBLISH_BLOCKED") ||
			line.includes("TASK_FAIL") ||
			line.includes("CRASH:") ||
			line.includes("PARSE_FAIL:") ||
			line.includes("GENERATE_ERROR") ||
			line.includes("FAILED:") ||
			line.includes("run failed exit_code=") ||
			line.includes("PIPELINE FAILED:")
		) {
			terminalLine = line;
			const codeMatch = line.match(/code (\d+)|exit_code=(\d+)/);
			const exitCode = Number(codeMatch?.[1] || codeMatch?.[2] || Number.NaN);
			if (exitCode === 201) {
				failure = {
					disposition: "pending",
					category: "proof_gap",
					retryable: true,
					matchedRule: "task_exit_code_201",
					message: line.trim(),
				};
			} else {
				failure = classifyFailureMessage(line);
			}
			status = failure.disposition;
		}
	}
	return { status, failure, terminal_line: terminalLine };
}

export function getLatestDailyLogs(limit = 3): string[] {
	const base = path.join(process.cwd(), "logs", "daily");
	if (!fs.existsSync(base)) return [];
	return fs
		.readdirSync(base)
		.filter((name) => name.endsWith(".log"))
		.map((name) => path.join(base, name))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
		.slice(0, limit);
}
