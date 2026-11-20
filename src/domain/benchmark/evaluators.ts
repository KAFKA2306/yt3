import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { loadYawaCast, type YawaCharacter } from "../yawa_daily.js";
import { validateYawaRun } from "../yawa_validation.js";
import { YOUTUBE_PROFILES } from "../youtube_profiles.js";

export const BENCHMARK_VERSION = "1.0.0" as const;

export type BenchmarkProduct = "byosan" | "yawa" | "humanity";
export type CheckStatus = "PASS" | "FAIL" | "WARN" | "UNVERIFIED";

export type BenchmarkCheck = {
	id: string;
	layer: "L1_DETERMINISTIC";
	status: CheckStatus;
	severity: "critical" | "warning";
	message: string;
	evidence?: string;
};

export type RunBenchmarkResult = {
	product: BenchmarkProduct;
	run_id: string;
	run_dir: string;
	status: "PASS" | "FAIL" | "UNVERIFIED";
	critical_failures: number;
	warnings: number;
	checks: BenchmarkCheck[];
	metrics: Record<string, number | string | boolean | null>;
};

export type ChannelBenchmarkSummary = {
	benchmark_version: typeof BENCHMARK_VERSION;
	product: BenchmarkProduct;
	evaluated_at: string;
	runs_evaluated: number;
	pass_count: number;
	fail_count: number;
	unverified_count: number;
	cross_run_checks: BenchmarkCheck[];
	runs: RunBenchmarkResult[];
};

const BYOSAN_INVESTMENT_ADVICE_PATTERN =
	/今すぐ買え|今すぐ買うべき|全力買い|買い推奨|売り推奨|暴落確定|爆益確定|絶対上がる|確実に儲かる|買えば儲かる|投資推奨|必勝法|損しない銘柄/g;

const YAWA_AD_UNFRIENDLY_PATTERN =
	/R18|R-18|18禁|エロ|性的興奮|性的|喘ぎ|耳舐め|添い寝|官能|フェチ|バイノーラル舐め|心理学研究のため|教育・研究目的/gi;

const YAWA_PROHIBITED_BREATH_PATTERN =
	/耳元で息|息を吹きかけ|長い吐息|擦れた息|荒い息|湿った息/g;

const YAWA_LATE_NIGHT_CARE_PATTERN =
	/終電|寝かしつけ|眠れるまで|おやすみ|深夜.*残業|残業.*終電/;

const HUMANITY_TITLE_SUFFIX_PATTERN = /\s*[|｜]\s*人類観測所の音楽\s*$/;

const MIN_THUMBNAIL_BYTES = 1024;
const MAX_HUMANITY_BASE_TITLE_CHARS = 15;
const MIN_HUMANITY_BASE_TITLE_CHARS = 3;

function readJsonSafe(filePath: string): Record<string, unknown> | null {
	if (!fs.existsSync(filePath)) return null;
	try {
		const raw = fs.readJsonSync(filePath) as unknown;
		return typeof raw === "object" && raw !== null
			? (raw as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function readJsonArraySafe(filePath: string): unknown[] | null {
	if (!fs.existsSync(filePath)) return null;
	try {
		const raw = fs.readJsonSync(filePath) as unknown;
		return Array.isArray(raw) ? raw : null;
	} catch {
		return null;
	}
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
	const flags = pattern.flags.includes("g")
		? pattern.flags
		: `${pattern.flags}g`;
	const re = new RegExp(pattern.source, flags);
	const found = new Set<string>();
	for (const match of text.matchAll(re)) {
		if (match[0]) found.add(match[0]);
	}
	return [...found];
}

function summarizeRunStatus(checks: BenchmarkCheck[]): {
	status: "PASS" | "FAIL" | "UNVERIFIED";
	critical_failures: number;
	warnings: number;
} {
	const critical_failures = checks.filter(
		(c) => c.status === "FAIL" && c.severity === "critical",
	).length;
	const warnings = checks.filter(
		(c) =>
			c.status === "WARN" || (c.status === "FAIL" && c.severity === "warning"),
	).length;
	const hasCriticalUnverified = checks.some(
		(c) => c.status === "UNVERIFIED" && c.severity === "critical",
	);
	if (critical_failures > 0) {
		return { status: "FAIL", critical_failures, warnings };
	}
	if (hasCriticalUnverified) {
		return { status: "UNVERIFIED", critical_failures, warnings };
	}
	return { status: "PASS", critical_failures, warnings };
}

export function extractHumanityBaseTitle(rawTitle: string): string {
	return rawTitle
		.trim()
		.replace(HUMANITY_TITLE_SUFFIX_PATTERN, "")
		.replace(/\s*[|｜].*$/, "")
		.trim();
}

function loadStoryWorldKeywords(repoRoot: string): string[] {
	const file = path.join(repoRoot, "docs", "humanity", "story-world.json");
	const data = readJsonSafe(file);
	const keywords = new Set<string>(["晴れ待ち坂", "人類観測所", "測候所"]);
	if (data && Array.isArray(data.characters)) {
		for (const item of data.characters) {
			if (typeof item === "object" && item !== null && "name" in item) {
				const name = String((item as { name: unknown }).name).trim();
				if (name) {
					keywords.add(name);
					for (const part of name.split(/\s+/)) {
						if (part.length >= 2) keywords.add(part);
					}
				}
			}
		}
	}
	return [...keywords];
}

function findThumbnailInfo(
	runDir: string,
	candidates: string[],
	explicitPath?: string,
): { exists: boolean; filePath: string | null; sizeBytes: number } {
	const pathsToCheck = [
		...(explicitPath ? [explicitPath] : []),
		...candidates.map((name) => path.join(runDir, name)),
	];
	for (const candidate of pathsToCheck) {
		if (!fs.existsSync(candidate)) continue;
		const stat = fs.statSync(candidate);
		if (stat.isFile() && stat.size >= MIN_THUMBNAIL_BYTES) {
			return { exists: true, filePath: candidate, sizeBytes: stat.size };
		}
	}
	return { exists: false, filePath: null, sizeBytes: 0 };
}

export function evaluateByosanRun(runDir: string): RunBenchmarkResult {
	const runName = path.basename(runDir);
	const runId = `byosan_money/${runName}`;
	const checks: BenchmarkCheck[] = [];

	const failureTracePath = path.join(runDir, "audit", "failure_trace.json");
	const featureSpecPath = path.join(runDir, "source", "feature_spec.json");
	const failureTrace = readJsonSafe(failureTracePath);
	const featureSpec = readJsonSafe(featureSpecPath);
	const metadata = readJsonSafe(path.join(runDir, "metadata.json"));
	const auditResult = readJsonSafe(path.join(runDir, "audit", "result.json"));
	const authenticity = readJsonSafe(
		path.join(runDir, "audit", "authenticity.json"),
	);
	const draftIssues = readJsonArraySafe(
		path.join(runDir, "audit", "feature_draft_issues.json"),
	);
	const publishState = readJsonSafe(path.join(runDir, "publish", "state.json"));

	if (failureTrace || !featureSpec) {
		const symptom =
			typeof failureTrace?.symptom === "string"
				? failureTrace.symptom
				: "source/feature_spec.json is missing";
		checks.push({
			id: "pipeline_completed",
			layer: "L1_DETERMINISTIC",
			status: "FAIL",
			severity: "critical",
			message: `Production pipeline did not complete: ${symptom}`,
			evidence: failureTrace ? failureTracePath : featureSpecPath,
		});
	} else {
		checks.push({
			id: "pipeline_completed",
			layer: "L1_DETERMINISTIC",
			status: "PASS",
			severity: "critical",
			message: "feature_spec.json present with no failure_trace.json",
		});
	}

	if (auditResult) {
		const failedKeys = Object.entries(auditResult)
			.filter(([, val]) => {
				const status =
					typeof val === "object" && val !== null && "status" in val
						? (val as { status?: unknown }).status
						: undefined;
				return status !== "PASS";
			})
			.map(([k]) => k);
		const authFailed = authenticity !== null && authenticity.status !== "PASS";
		if (failedKeys.length > 0 || authFailed) {
			checks.push({
				id: "existing_audits_pass",
				layer: "L1_DETERMINISTIC",
				status: "FAIL",
				severity: "critical",
				message: `Audit failures: ${[...failedKeys, ...(authFailed ? ["authenticity"] : [])].join(", ")}`,
			});
		} else {
			checks.push({
				id: "existing_audits_pass",
				layer: "L1_DETERMINISTIC",
				status: "PASS",
				severity: "critical",
				message: "audit/result.json and authenticity.json passed",
			});
		}
	} else {
		checks.push({
			id: "existing_audits_pass",
			layer: "L1_DETERMINISTIC",
			status: failureTrace ? "FAIL" : "UNVERIFIED",
			severity: "critical",
			message: "audit/result.json missing",
		});
	}

	const draftIssueCount = draftIssues?.length ?? 0;
	checks.push({
		id: "no_ungrounded_draft_figures",
		layer: "L1_DETERMINISTIC",
		status: draftIssueCount === 0 ? "PASS" : "WARN",
		severity: "warning",
		message:
			draftIssueCount === 0
				? "0 ungrounded draft figure diagnostics"
				: `${draftIssueCount} draft figure diagnostic(s) recorded`,
	});

	const corpusParts: string[] = [];
	if (typeof metadata?.title === "string") corpusParts.push(metadata.title);
	if (typeof metadata?.description === "string")
		corpusParts.push(metadata.description);
	if (typeof featureSpec?.title === "string")
		corpusParts.push(featureSpec.title);
	if (typeof featureSpec?.descriptionLead === "string")
		corpusParts.push(featureSpec.descriptionLead);
	if (Array.isArray(featureSpec?.segments)) {
		for (const seg of featureSpec.segments) {
			if (typeof seg === "object" && seg !== null && "text" in seg) {
				corpusParts.push(String((seg as { text: unknown }).text));
			}
		}
	}
	const adviceMatches = uniqueMatches(
		corpusParts.join("\n"),
		BYOSAN_INVESTMENT_ADVICE_PATTERN,
	);
	checks.push({
		id: "no_investment_advice",
		layer: "L1_DETERMINISTIC",
		status: adviceMatches.length === 0 ? "PASS" : "FAIL",
		severity: "critical",
		message:
			adviceMatches.length === 0
				? "No prohibited investment-advice phrases detected"
				: `Prohibited investment-advice phrases found: ${adviceMatches.join(", ")}`,
	});

	const thumb = findThumbnailInfo(runDir, [
		"thumbnail_youtube.jpg",
		"thumbnail.png",
		"thumbnail.jpg",
	]);
	checks.push({
		id: "thumbnail_present",
		layer: "L1_DETERMINISTIC",
		status: thumb.exists ? "PASS" : "WARN",
		severity: "warning",
		message: thumb.exists
			? `Thumbnail present (${thumb.sizeBytes} bytes)`
			: "Thumbnail missing or empty",
	});

	if (publishState) {
		const verified =
			publishState.phase === "VERIFIED" &&
			publishState.observed_visibility === "public";
		checks.push({
			id: "publish_integrity",
			layer: "L1_DETERMINISTIC",
			status: verified ? "PASS" : "FAIL",
			severity: "critical",
			message: verified
				? `Published and verified (video_id=${String(publishState.video_id ?? "unknown")})`
				: `Publish state not VERIFIED/public (phase=${String(publishState.phase)}, visibility=${String(publishState.observed_visibility)})`,
		});
	} else {
		checks.push({
			id: "publish_integrity",
			layer: "L1_DETERMINISTIC",
			status: "UNVERIFIED",
			severity: "warning",
			message: "Run not published (no publish/state.json)",
		});
	}

	const summary = summarizeRunStatus(checks);
	const title =
		typeof metadata?.title === "string"
			? metadata.title
			: typeof featureSpec?.title === "string"
				? featureSpec.title
				: null;
	return {
		product: "byosan",
		run_id: runId,
		run_dir: runDir,
		...summary,
		checks,
		metrics: {
			title,
			draft_issue_count: draftIssueCount,
			thumbnail_bytes: thumb.sizeBytes,
			published: publishState?.phase === "VERIFIED",
		},
	};
}

function extractYawaText(script: Record<string, unknown> | null): {
	fullText: string;
	actingText: string;
	metaText: string;
} {
	if (!script) return { fullText: "", actingText: "", metaText: "" };
	const metaParts: string[] = [];
	if (typeof script.title === "string") metaParts.push(script.title);
	if (typeof script.description === "string")
		metaParts.push(script.description);
	if (Array.isArray(script.tags)) {
		metaParts.push(script.tags.map((t) => String(t)).join(" "));
	}
	const dialogueParts: string[] = [];
	const actingParts: string[] = [];
	const collectSegment = (seg: unknown) => {
		if (typeof seg === "string") {
			dialogueParts.push(seg);
			return;
		}
		if (typeof seg !== "object" || seg === null) return;
		const obj = seg as Record<string, unknown>;
		if (typeof obj.text === "string") dialogueParts.push(obj.text);
		if (typeof obj.acting === "string") actingParts.push(obj.acting);
		if (typeof obj.direction === "string") actingParts.push(obj.direction);
		if (typeof obj.tone === "string") actingParts.push(obj.tone);
	};
	if (Array.isArray(script.chapters)) {
		for (const chapter of script.chapters) {
			if (
				typeof chapter === "object" &&
				chapter !== null &&
				Array.isArray((chapter as { segments?: unknown }).segments)
			) {
				for (const seg of (chapter as { segments: unknown[] }).segments) {
					collectSegment(seg);
				}
			}
		}
	}
	if (Array.isArray(script.segments)) {
		for (const seg of script.segments) collectSegment(seg);
	}
	const metaText = metaParts.join("\n");
	const actingText = actingParts.join("\n");
	return {
		metaText,
		actingText,
		fullText: [metaText, ...dialogueParts, actingText].join("\n"),
	};
}

function detectYawaCastCharacter(
	script: Record<string, unknown> | null,
	state: Record<string, unknown> | null,
	cast: YawaCharacter[],
): YawaCharacter | null {
	const explicitId =
		(typeof state?.character_id === "string" && state.character_id) ||
		(typeof script?.character_id === "string" && script.character_id) ||
		null;
	if (explicitId) {
		const exact = cast.find((c) => c.id === explicitId);
		if (exact) return exact;
	}
	const haystack = [
		typeof script?.title === "string" ? script.title : "",
		typeof script?.description === "string" ? script.description : "",
		typeof script?.character === "string" ? script.character : "",
		typeof state?.character_name === "string" ? state.character_name : "",
	].join("\n");
	for (const member of cast) {
		const compactName = member.name.replace(/\s+/g, "");
		if (haystack.includes(member.name) || haystack.includes(compactName)) {
			return member;
		}
	}
	return null;
}

export function evaluateYawaRun(
	runDir: string,
	options?: { castCharacters?: YawaCharacter[]; repoRoot?: string },
): RunBenchmarkResult {
	const repoRoot = options?.repoRoot ?? process.cwd();
	const cast =
		options?.castCharacters ??
		(fs.existsSync(path.join(repoRoot, "docs", "yawa", "characters.json"))
			? loadYawaCast(repoRoot).characters
			: []);
	const runName = path.basename(runDir);
	const runId = `yawa_archive/${runName}`;
	const checks: BenchmarkCheck[] = [];

	const script = readJsonSafe(path.join(runDir, "script.json"));
	const state = readJsonSafe(path.join(runDir, "state.json"));
	const publishState = readJsonSafe(path.join(runDir, "publish", "state.json"));

	if (publishState) {
		const validation = validateYawaRun(
			runDir,
			YOUTUBE_PROFILES.yawa.expectedChannelTitle,
		);
		checks.push({
			id: "core_media_and_publish",
			layer: "L1_DETERMINISTIC",
			status: validation.status === "PASS" ? "PASS" : "FAIL",
			severity: "critical",
			message:
				validation.status === "PASS"
					? "validateYawaRun passed (media, audit, publish receipt & SHA256 verified)"
					: `validateYawaRun failed: ${validation.failures.join("; ")}`,
		});
	} else {
		const auditResult = readJsonSafe(path.join(runDir, "audit", "result.json"));
		const videoExists = fs.existsSync(path.join(runDir, "video.mp4"));
		const badAudits = auditResult
			? Object.entries(auditResult)
					.filter(([, v]) => (v as { status?: string })?.status !== "PASS")
					.map(([k]) => k)
			: ["audit/result.json missing"];
		checks.push({
			id: "core_media_and_publish",
			layer: "L1_DETERMINISTIC",
			status: videoExists && badAudits.length === 0 ? "PASS" : "FAIL",
			severity: "critical",
			message:
				videoExists && badAudits.length === 0
					? "Local media and audit/result.json passed (unpublished)"
					: `Missing video or failed audits: ${[...(videoExists ? [] : ["video.mp4"]), ...badAudits].join(", ")}`,
		});
	}

	const matchedCast = detectYawaCastCharacter(script, state, cast);
	const refPath = matchedCast
		? path.join(
				repoRoot,
				"data",
				"state",
				"yawa",
				"references",
				`${matchedCast.id}.wav`,
			)
		: null;
	const hasPersistentRef = refPath ? fs.existsSync(refPath) : false;
	checks.push({
		id: "fixed_cast_member",
		layer: "L1_DETERMINISTIC",
		status: matchedCast ? "PASS" : "FAIL",
		severity: "critical",
		message: matchedCast
			? `Matched fixed cast: ${matchedCast.name} (${matchedCast.id}), persistent_ref=${hasPersistentRef}`
			: "No fixed cast character from docs/yawa/characters.json detected in run metadata/script",
	});

	const { fullText, actingText, metaText } = extractYawaText(script);
	const adMatches = uniqueMatches(fullText, YAWA_AD_UNFRIENDLY_PATTERN);
	checks.push({
		id: "ad_friendly_metadata",
		layer: "L1_DETERMINISTIC",
		status: adMatches.length === 0 ? "PASS" : "FAIL",
		severity: "critical",
		message:
			adMatches.length === 0
				? "No prohibited adult/18+/EDSA-disguise terms detected"
				: `Ad-unfriendly terms found: ${adMatches.join(", ")}`,
	});

	const breathMatches = uniqueMatches(
		`${actingText}\n${fullText}`,
		YAWA_PROHIBITED_BREATH_PATTERN,
	);
	checks.push({
		id: "no_prohibited_breath_cues",
		layer: "L1_DETERMINISTIC",
		status: breathMatches.length === 0 ? "PASS" : "FAIL",
		severity: "critical",
		message:
			breathMatches.length === 0
				? "No prohibited breath/mouth-sound cues found"
				: `Prohibited breath cues found: ${breathMatches.join(", ")}`,
	});

	const thumb = findThumbnailInfo(runDir, [
		"thumbnail.jpg",
		"thumbnail.png",
		"cover.png",
		"cover.jpg",
	]);
	checks.push({
		id: "thumbnail_present",
		layer: "L1_DETERMINISTIC",
		status: thumb.exists ? "PASS" : "FAIL",
		severity: "critical",
		message: thumb.exists
			? `Character thumbnail present (${thumb.sizeBytes} bytes)`
			: "Thumbnail missing (image generation skipped or failed)",
	});

	const lateNightTrope = YAWA_LATE_NIGHT_CARE_PATTERN.test(metaText);
	const summary = summarizeRunStatus(checks);
	return {
		product: "yawa",
		run_id: runId,
		run_dir: runDir,
		...summary,
		checks,
		metrics: {
			title: typeof script?.title === "string" ? script.title : null,
			character_id: matchedCast?.id ?? null,
			character_name: matchedCast?.name ?? null,
			persistent_ref_exists: hasPersistentRef,
			thumbnail_bytes: thumb.sizeBytes,
			late_night_care_trope: lateNightTrope,
			published: publishState?.phase === "VERIFIED",
		},
	};
}

export function evaluateYawaCrossRun(
	runs: RunBenchmarkResult[],
): BenchmarkCheck[] {
	const checks: BenchmarkCheck[] = [];
	if (runs.length < 3) {
		checks.push({
			id: "cast_rotation",
			layer: "L1_DETERMINISTIC",
			status: "UNVERIFIED",
			severity: "warning",
			message: `Need at least 3 runs to assess cast rotation (have ${runs.length})`,
		});
		return checks;
	}
	const recent3 = runs.slice(0, 3);
	const castIds = recent3.map((r) => String(r.metrics.character_id ?? "none"));
	const allSameCast = castIds.every((id) => id === castIds[0]);
	checks.push({
		id: "cast_rotation",
		layer: "L1_DETERMINISTIC",
		status: allSameCast ? "WARN" : "PASS",
		severity: "warning",
		message: allSameCast
			? `Last 3 runs all used the same cast slot (${castIds[0]})`
			: `Cast rotation healthy across last 3 runs (${castIds.join(" -> ")})`,
	});

	const allLateNight = recent3.every(
		(r) => r.metrics.late_night_care_trope === true,
	);
	checks.push({
		id: "no_late_night_care_convergence",
		layer: "L1_DETERMINISTIC",
		status: allLateNight ? "WARN" : "PASS",
		severity: "warning",
		message: allLateNight
			? "Last 3 runs all converged on late-night/sleep-care tropes"
			: "No 3-run convergence on late-night/sleep-care tropes",
	});
	return checks;
}

export function evaluateHumanityRun(
	runDir: string,
	options?: { storyWorldKeywords?: string[]; repoRoot?: string },
): RunBenchmarkResult {
	const repoRoot = options?.repoRoot ?? process.cwd();
	const storyKeywords =
		options?.storyWorldKeywords ?? loadStoryWorldKeywords(repoRoot);
	const runName = path.basename(runDir);
	const runId = `humanity_observatory/${runName}`;
	const checks: BenchmarkCheck[] = [];

	const state = readJsonSafe(path.join(runDir, "state.json"));
	const auditResult = readJsonSafe(path.join(runDir, "audit", "result.json"));
	const publishState = readJsonSafe(path.join(runDir, "publish", "state.json"));
	const metadata =
		typeof state?.metadata === "object" && state.metadata !== null
			? (state.metadata as Record<string, unknown>)
			: null;

	const requiredAudits = [
		"music_integrity",
		"music_provenance",
		"visual_provenance",
		"music_rights",
	];
	if (auditResult) {
		const failedAudits = requiredAudits.filter((key) => {
			const entry = auditResult[key] as { status?: string } | undefined;
			return entry?.status !== "PASS";
		});
		checks.push({
			id: "music_audits_pass",
			layer: "L1_DETERMINISTIC",
			status: failedAudits.length === 0 ? "PASS" : "FAIL",
			severity: "critical",
			message:
				failedAudits.length === 0
					? "All 4 deterministic music audits passed"
					: `Failed or missing music audits: ${failedAudits.join(", ")}`,
		});
	} else {
		checks.push({
			id: "music_audits_pass",
			layer: "L1_DETERMINISTIC",
			status: "FAIL",
			severity: "critical",
			message: "audit/result.json is missing",
		});
	}

	const disclosed = state?.contains_synthetic_media === true;
	checks.push({
		id: "synthetic_media_disclosed",
		layer: "L1_DETERMINISTIC",
		status: disclosed ? "PASS" : "FAIL",
		severity: "critical",
		message: disclosed
			? "contains_synthetic_media is true"
			: "contains_synthetic_media is missing or false",
	});

	const rawTitle = typeof metadata?.title === "string" ? metadata.title : "";
	const baseTitle = extractHumanityBaseTitle(rawTitle);
	const baseTitleChars = [...baseTitle].length;
	const titleOk =
		baseTitleChars >= MIN_HUMANITY_BASE_TITLE_CHARS &&
		baseTitleChars <= MAX_HUMANITY_BASE_TITLE_CHARS;
	checks.push({
		id: "short_memorable_title",
		layer: "L1_DETERMINISTIC",
		status: titleOk ? "PASS" : "FAIL",
		severity: "critical",
		message: titleOk
			? `Base title length is ${baseTitleChars} chars ("${baseTitle}")`
			: `Base title length ${baseTitleChars} chars outside ${MIN_HUMANITY_BASE_TITLE_CHARS}-${MAX_HUMANITY_BASE_TITLE_CHARS} range ("${baseTitle}")`,
	});

	const explicitThumb =
		typeof state?.thumbnail_path === "string"
			? state.thumbnail_path
			: undefined;
	const thumb = findThumbnailInfo(
		runDir,
		["thumbnail.jpg", "thumbnail.png", "jacket.png", "jacket.jpg"],
		explicitThumb,
	);
	checks.push({
		id: "jacket_thumbnail_present",
		layer: "L1_DETERMINISTIC",
		status: thumb.exists ? "PASS" : "FAIL",
		severity: "critical",
		message: thumb.exists
			? `Thumbnail/jacket present (${thumb.sizeBytes} bytes)`
			: "Jacket thumbnail missing or empty",
	});

	const description =
		typeof metadata?.description === "string" ? metadata.description : "";
	const matchedStoryTerms = storyKeywords.filter((kw) =>
		description.includes(kw),
	);
	const storyOk =
		description.trim().length >= 40 && matchedStoryTerms.length > 0;
	checks.push({
		id: "story_world_reference",
		layer: "L1_DETERMINISTIC",
		status: storyOk ? "PASS" : "WARN",
		severity: "warning",
		message: storyOk
			? `Story-world context present (${matchedStoryTerms.slice(0, 4).join(", ")})`
			: "Description lacks story-world setting or character references",
	});

	if (publishState) {
		const verified =
			publishState.phase === "VERIFIED" &&
			publishState.observed_visibility === "public";
		checks.push({
			id: "publish_integrity",
			layer: "L1_DETERMINISTIC",
			status: verified ? "PASS" : "FAIL",
			severity: "critical",
			message: verified
				? `Published and verified (video_id=${String(publishState.video_id ?? "unknown")})`
				: `Publish state not VERIFIED/public (phase=${String(publishState.phase)})`,
		});
	} else {
		checks.push({
			id: "publish_integrity",
			layer: "L1_DETERMINISTIC",
			status: "UNVERIFIED",
			severity: "warning",
			message: "Run not published (no publish/state.json)",
		});
	}

	const summary = summarizeRunStatus(checks);
	return {
		product: "humanity",
		run_id: runId,
		run_dir: runDir,
		...summary,
		checks,
		metrics: {
			raw_title: rawTitle || null,
			base_title: baseTitle || null,
			base_title_chars: baseTitleChars,
			thumbnail_bytes: thumb.sizeBytes,
			story_world_terms_matched: matchedStoryTerms.length,
			published: publishState?.phase === "VERIFIED",
		},
	};
}

export type LexiconMetrics = {
	documents: number;
	mattr_mean: number | null;
	jaccard_mean: number | null;
	jaccard_max: number | null;
};

export function parseLexiconReport(stdout: string): LexiconMetrics {
	const docsMatch = stdout.match(/documents=(\d+)/);
	const mattrMatch = stdout.match(/MATTR\(window=\d+\)\s+mean=([0-9.]+)/);
	const jaccardMatch = stdout.match(
		/pairwise Jaccard mean=([0-9.]+)\s+max=([0-9.]+)/,
	);
	return {
		documents: docsMatch ? Number(docsMatch[1]) : 0,
		mattr_mean: mattrMatch ? Number(mattrMatch[1]) : null,
		jaccard_mean: jaccardMatch ? Number(jaccardMatch[1]) : null,
		jaccard_max: jaccardMatch ? Number(jaccardMatch[2]) : null,
	};
}

export function lexiconMetricsToCheck(metrics: LexiconMetrics): BenchmarkCheck {
	if (metrics.jaccard_max === null) {
		return {
			id: "lexicon_diversity",
			layer: "L1_DETERMINISTIC",
			status: "UNVERIFIED",
			severity: "warning",
			message: `Not enough comparable documents for Jaccard diversity (documents=${metrics.documents})`,
		};
	}
	const highOverlap = metrics.jaccard_max > 0.55;
	return {
		id: "lexicon_diversity",
		layer: "L1_DETERMINISTIC",
		status: highOverlap ? "WARN" : "PASS",
		severity: "warning",
		message: `MATTR=${metrics.mattr_mean?.toFixed(3) ?? "n/a"}, pairwise Jaccard mean=${metrics.jaccard_mean?.toFixed(3) ?? "n/a"}, max=${metrics.jaccard_max.toFixed(3)} (threshold <= 0.55)`,
	};
}

export const BinaryRubricCriterionSchema = z.object({
	criterion_id: z.string().min(1),
	rationale: z.string().min(10),
	pass: z.boolean(),
});

export const SingleJudgeVerdictSchema = z.object({
	criteria: z.array(BinaryRubricCriterionSchema).min(1),
	summary: z.string().min(10),
});

export const CompareJudgeVerdictSchema = z.object({
	criteria_comparison: z
		.array(
			z.object({
				criterion_id: z.string().min(1),
				rationale: z.string().min(10),
				preferred: z.enum(["A", "B", "TIE"]),
			}),
		)
		.min(1),
	overall_rationale: z.string().min(10),
	overall_preferred: z.enum(["A", "B", "TIE"]),
});

export type RubricDefinition = {
	id: string;
	question: string;
};

export const CHANNEL_JUDGE_RUBRICS: Record<
	BenchmarkProduct,
	RubricDefinition[]
> = {
	byosan: [
		{
			id: "regime_shift_and_verification_split",
			question:
				"価格・指数・一次資料で確認できた事実（レジーム変化）と、SNSやタイムライン上の未確認主張（UNVERIFIED）を明確に仕分け、未確認の噂を事実として断定していないか。",
		},
		{
			id: "structural_clarity",
			question:
				"単なるニュースの読み上げではなく、一次資料の数字の背景にある構造や因果が一般の投資家・ビジネス層に腑に落ちる形で説明されているか。",
		},
		{
			id: "source_discipline",
			question:
				"根拠のない断定・投資助言（「今すぐ買え」「暴落確定」等）・根拠なき家計換算をせず、事実・推計・前提を区別しているか。",
		},
		{
			id: "title_and_hook_fit",
			question:
				"タイトルと導入が誇張や釣りにならず、具体的な数字・固有名詞・常識とのズレで「今見る理由」を伝えているか。",
		},
	],
	yawa: [
		{
			id: "character_voice_and_presence",
			question:
				"固定キャストの性格・距離感・語尾のニュアンスが台本全体で一貫しており、「またこの人の声を聴きたい」と思える会話劇になっているか。",
		},
		{
			id: "fresh_scenario_not_repetitive",
			question:
				"ありきたりな「終電後の弱音＋寝かしつけ」テンプレに逃げず、場面・小道具・掛け合いの展開に固有の魅力があるか。",
		},
		{
			id: "all_ages_ad_safety",
			question:
				"全年齢・YouTube広告適合（緑アイコン）の範囲に明確に収まり、性的連想や過度な密着ロールプレイ・不自然な言い訳文を含まないか。",
		},
	],
	humanity: [
		{
			id: "singable_hook_and_freshness",
			question:
				"説明的な散文エッセイではなく、サビに声に出したくなるフック・リズムがあり、「少し・静か・そっと・余白・決めない」系の微温テンプレの焼き直しになっていないか。",
		},
		{
			id: "standalone_emotional_hook",
			question:
				"初聴きでも一曲だけで情景と感情の動きがくっきり浮かび、ありふれた汎用BGM歌詞に埋もれていないか。",
		},
		{
			id: "memorable_short_title_fit",
			question:
				"曲名が3〜15文字前後で口ずさみやすく、あらすじ説明にならず、歌詞の核と響き合っているか。",
		},
		{
			id: "story_world_cohesion",
			question:
				"「晴れ待ち坂」の舞台・人物関係と矛盾せず、概要欄で世界観や背景が自然に補足されているか。",
		},
	],
};

export function extractBlindArtifactText(
	product: BenchmarkProduct,
	runDir: string,
): string {
	if (product === "byosan") {
		const spec = readJsonSafe(path.join(runDir, "source", "feature_spec.json"));
		const meta = readJsonSafe(path.join(runDir, "metadata.json"));
		const segments = Array.isArray(spec?.segments)
			? spec.segments
					.map((s) =>
						typeof s === "object" && s !== null && "text" in s
							? String((s as { text: unknown }).text)
							: "",
					)
					.filter(Boolean)
					.join("\n")
			: "";
		return [
			`[Title] ${String(meta?.title ?? spec?.title ?? "(missing)")}`,
			`[ThumbnailTitle] ${String(meta?.thumbnail_title ?? spec?.thumbnailTitle ?? "(missing)")}`,
			`[Angle] ${String(spec?.angle ?? "(missing)")}`,
			`[Description] ${String(meta?.description ?? spec?.descriptionLead ?? "").slice(0, 1500)}`,
			`[Script]\n${segments.slice(0, 8000)}`,
		].join("\n\n");
	}
	if (product === "yawa") {
		const script = readJsonSafe(path.join(runDir, "script.json"));
		const { fullText } = extractYawaText(script);
		return fullText.slice(0, 10000);
	}
	const state = readJsonSafe(path.join(runDir, "state.json"));
	const meta =
		typeof state?.metadata === "object" && state.metadata !== null
			? (state.metadata as Record<string, unknown>)
			: null;
	const lyricsPath = path.join(runDir, "lyrics.txt");
	const lyrics = fs.existsSync(lyricsPath)
		? fs.readFileSync(lyricsPath, "utf8")
		: "";
	return [
		`[Title] ${String(meta?.title ?? "(missing)")}`,
		`[Description] ${String(meta?.description ?? "(missing)").slice(0, 2000)}`,
		`[Lyrics]\n${lyrics.slice(0, 6000)}`,
	].join("\n\n");
}
