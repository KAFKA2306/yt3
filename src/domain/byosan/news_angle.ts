import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { ByosanActiveProbeEvidenceSchema } from "./active_probe.js";
import {
	ByosanArchetypeEvidenceBundleSchema,
	ByosanNarrativeArchetypeSchema,
	selectByosanNarrativeArchetype,
} from "./narrative_archetype.js";

export const ByosanSourceTierSchema = z.enum([
	"L1",
	"L2",
	"L3",
	"L4",
	"L5",
	"unknown",
]);

const ByosanSourceSupportsSchema = z.preprocess(
	(value) => (typeof value === "string" ? [value] : value),
	z.array(z.string().min(3)).min(1),
);

const ByosanAngleSourceSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(2),
	url: z.string().url(),
	publishedAt: z.string().min(4).optional(),
	tier: ByosanSourceTierSchema,
	// Some providers serialize a single claim mapping as a string. Normalize
	// that losslessly at the schema boundary; missing mappings still fail closed.
	supports: ByosanSourceSupportsSchema,
});

const ByosanAdversarialEvidenceKindSchema = z.enum([
	"measurement_condition",
	"counter_metric",
	"third_party_disagreement",
	"source_limitation",
	"no_counter_evidence",
]);

export const ByosanAdversarialEvidenceSchema = z.object({
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	kind: ByosanAdversarialEvidenceKindSchema,
	targetClaim: z.string().min(8),
	statement: z.string().min(8),
	sourceIds: z.array(z.string().min(1)).min(1),
	checkedSourceIds: z.array(z.string().min(1)).min(1),
});

export type ByosanAdversarialEvidence = z.infer<
	typeof ByosanAdversarialEvidenceSchema
>;

const ByosanExplorationProfileSchema = z.object({
	geography: z.string().min(2),
	sector: z.string().min(2),
	actorType: z.string().min(2),
	eventType: z.string().min(2),
	timeHorizon: z.string().min(2),
	causalDirection: z.string().min(2),
	financialMetric: z.string().min(2),
	supplyChainLayer: z.string().min(2),
	marketRealEconomy: z.string().min(2),
	dataSurface: z.string().min(2),
	scale: z.string().min(2),
});

type ByosanExplorationProfile = z.infer<typeof ByosanExplorationProfileSchema>;

export const ByosanAngleCandidateSchema = z.object({
	topic: z.string().min(3),
	angle: z.string().min(8),
	titleHook: z.string().min(8),
	whyNow: z.string().min(8),
	hiddenMechanism: z.string().min(12),
	counterfactual: z.string().min(12),
	audiencePayoff: z.string().min(8),
	numbers: z.array(z.string().min(1)).min(2),
	sources: z.array(ByosanAngleSourceSchema).min(2),
	noveltyFingerprint: z.string().min(8),
	visualPlan: z.string().min(8),
	risks: z.array(z.string().min(3)).min(1),
	explorationProfile: ByosanExplorationProfileSchema,
	adversarialEvidence: z.array(ByosanAdversarialEvidenceSchema).min(1).max(10),
	activeProbes: z.array(ByosanActiveProbeEvidenceSchema).max(8).optional(),
	archetypeEvidence: z
		.array(ByosanArchetypeEvidenceBundleSchema)
		.max(10)
		.optional(),
});

export type ByosanAngleCandidate = z.infer<typeof ByosanAngleCandidateSchema>;

type ByosanAngleCandidateSettlement =
	| { status: "VALID"; candidate: ByosanAngleCandidate }
	| { status: "REJECTED"; issues: string[] };

export function normalizeByosanAngleCandidateForm(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null) return raw;
	const candidate = raw as Record<string, unknown>;
	const numbers = Array.isArray(candidate.numbers)
		? candidate.numbers.map((value) =>
				typeof value === "number" ? String(value) : value,
			)
		: candidate.numbers;
	const sources = Array.isArray(candidate.sources)
		? candidate.sources.map((source: unknown) => {
				if (typeof source !== "object" || source === null) return source;
				const tier = (source as { tier?: unknown }).tier;
				return typeof tier === "string" && /^l[1-5]$/i.test(tier)
					? { ...source, tier: tier.toUpperCase() }
					: source;
			})
		: candidate.sources;
	return { ...candidate, numbers, sources };
}

export function settleByosanAngleCandidate(
	raw: unknown,
): ByosanAngleCandidateSettlement {
	const parsed = ByosanAngleCandidateSchema.safeParse(
		normalizeByosanAngleCandidateForm(raw),
	);
	if (parsed.success) return { status: "VALID", candidate: parsed.data };
	return {
		status: "REJECTED",
		issues: parsed.error.issues.map(
			(issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
		),
	};
}

const ByosanAngleScoresSchema = z.object({
	evidence: z.number().min(0).max(100),
	surprise: z.number().min(0).max(100),
	mechanism: z.number().min(0).max(100),
	counterfactual: z.number().min(0).max(100),
	audienceValue: z.number().min(0).max(100),
	novelty: z.number().min(0).max(100),
	visualizability: z.number().min(0).max(100),
});

const ByosanEvaluatedAngleSchema = z.object({
	candidate: ByosanAngleCandidateSchema,
	scores: ByosanAngleScoresSchema,
	weightedScore: z.number().min(0).max(100),
	maxRecentSimilarity: z.number().min(0).max(1),
	hardGateFailures: z.array(z.string()),
	passed: z.boolean(),
});

const ByosanAngleDecisionSchema = z.object({
	decision: z.enum(["PASS", "STOP"]),
	selectedIndex: z.number().int().min(0).nullable(),
	reason: z.string().min(1),
	candidateCount: z.number().int().min(0),
	distinctPublisherCount: z.number().int().min(0),
	orthogonality: z.object({
		uniqueProfileCount: z.number().int().min(0),
		geography: z.number().int().min(0),
		sector: z.number().int().min(0),
		actorType: z.number().int().min(0),
		eventType: z.number().int().min(0),
		timeHorizon: z.number().int().min(0),
		causalDirection: z.number().int().min(0),
		financialMetric: z.number().int().min(0),
		supplyChainLayer: z.number().int().min(0),
		marketRealEconomy: z.number().int().min(0),
		dataSurface: z.number().int().min(0),
		scale: z.number().int().min(0),
		failedAxes: z.array(z.string()),
	}),
	evaluated: z.array(ByosanEvaluatedAngleSchema),
});

export type ByosanAngleDecision = z.infer<typeof ByosanAngleDecisionSchema>;

export function isCurrentByosanAngleDecision(
	value: unknown,
): value is ByosanAngleDecision {
	return ByosanAngleDecisionSchema.safeParse(value).success;
}

export const ByosanProductionFormatSchema = z.enum([
	"breaking",
	"comparison",
	"deep_dive",
	"regular",
]);

export const ByosanProductionPlanSchema = z.object({
	format: ByosanProductionFormatSchema,
	targetMinutes: z.number().min(3).max(15),
	minSegments: z.number().int().min(12).max(40),
	maxSegments: z.number().int().min(12).max(40),
	reasons: z.array(z.string().min(1)).min(1),
	narrativeArchetype: ByosanNarrativeArchetypeSchema.optional(),
	archetypeRequiredSlots: z
		.array(z.string().regex(/^[a-z0-9_]+$/))
		.max(12)
		.optional(),
	archetypeReasons: z.array(z.string().min(1)).optional(),
	archetypeEvidence: ByosanArchetypeEvidenceBundleSchema.optional(),
	appliedPerformancePreference: ByosanProductionFormatSchema.optional(),
});

export type ByosanProductionFormat = z.infer<
	typeof ByosanProductionFormatSchema
>;
export type ByosanProductionPlan = z.infer<typeof ByosanProductionPlanSchema>;

function normalize(text: string): string {
	return text.normalize("NFKC").toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function tokens(text: string): Set<string> {
	const normalized = normalize(text);
	const result = new Set(
		normalized
			.replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
			.split(/\s+/)
			.filter((token) => token.length >= 2),
	);
	const compact = normalized.replaceAll(/[^\p{L}\p{N}]/gu, "");
	for (let index = 0; index < compact.length - 1; index++) {
		result.add(compact.slice(index, index + 2));
	}
	return result;
}

export function byosanTextSimilarity(
	leftText: string,
	rightText: string,
): number {
	const left = tokens(leftText);
	const right = tokens(rightText);
	const union = new Set([...left, ...right]);
	if (union.size === 0) return 0;
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) intersection++;
	}
	return intersection / union.size;
}

function distinctHosts(sources: ByosanAngleCandidate["sources"]): Set<string> {
	return new Set(
		sources.map((source) => {
			try {
				return new URL(source.url).hostname.replace(/^www\./, "");
			} catch {
				return source.url;
			}
		}),
	);
}

const PublishedRunSpecSchema = z.object({
	sources: z.array(z.object({ url: z.string().url() })),
});

function normalizedSourceUrl(url: string): string | null {
	const parsed = new URL(url);
	const pathname = parsed.pathname.replace(/\/+$/, "");
	return pathname === "" ? null : `${parsed.origin}${pathname}`;
}

export function repeatsPublishedSource(
	candidate: ByosanAngleCandidate,
	publishedSourceUrls: ReadonlySet<string>,
): boolean {
	return candidate.sources.some((source) => {
		const key = normalizedSourceUrl(source.url);
		return key !== null && publishedSourceUrls.has(key);
	});
}

const ORTHOGONALITY_MINIMUMS = {
	geography: 2,
	sector: 3,
	actorType: 3,
	eventType: 3,
	timeHorizon: 2,
	causalDirection: 3,
	financialMetric: 3,
	supplyChainLayer: 3,
	marketRealEconomy: 2,
	dataSurface: 3,
	scale: 2,
} as const satisfies Record<keyof ByosanExplorationProfile, number>;

type OrthogonalityAxis = keyof typeof ORTHOGONALITY_MINIMUMS;

function evaluateOrthogonality(
	candidates: ByosanAngleCandidate[],
): ByosanAngleDecision["orthogonality"] {
	const axes = Object.keys(ORTHOGONALITY_MINIMUMS) as OrthogonalityAxis[];
	const diversity = Object.fromEntries(
		axes.map((axis) => [
			axis,
			new Set(candidates.map((candidate) => candidate.explorationProfile[axis]))
				.size,
		]),
	) as Record<OrthogonalityAxis, number>;
	const uniqueProfileCount = new Set(
		candidates.map((candidate) =>
			axes.map((axis) => candidate.explorationProfile[axis]).join("\u001f"),
		),
	).size;
	const failedAxes = axes.filter(
		(axis) =>
			diversity[axis] <
			Math.min(ORTHOGONALITY_MINIMUMS[axis], candidates.length),
	);
	return {
		uniqueProfileCount,
		...diversity,
		failedAxes: failedAxes.map((axis) => `insufficient_${axis}_diversity`),
	};
}

function scoreTextDepth(text: string, targetLength: number): number {
	return Math.min(100, (Array.from(text).length / targetLength) * 100);
}

function concreteSignalCount(text: string): number {
	return (
		(text.match(/\d+(?:[.,]\d+)?/g)?.length ?? 0) +
		(text.match(/[%％兆億万ドル円倍ポイントbp]/g)?.length ?? 0)
	);
}

function freshestPrimarySourceAgeDays(
	candidate: ByosanAngleCandidate,
	currentDate: string,
): number | null {
	const now = Date.parse(`${currentDate}T23:59:59Z`);
	if (!Number.isFinite(now)) return null;
	const ages = candidate.sources
		.filter((source) => ["L1", "L2", "L3"].includes(source.tier))
		.flatMap((source) => {
			if (!source.publishedAt) return [];
			const timestamp = Date.parse(source.publishedAt);
			if (!Number.isFinite(timestamp)) return [];
			return [Math.max(0, (now - timestamp) / 86_400_000)];
		});
	return ages.length > 0 ? Math.min(...ages) : null;
}

export function selectByosanProductionPlan(
	evaluatedInput: z.infer<typeof ByosanEvaluatedAngleSchema>,
	currentDate: string,
	preferredFormat?: ByosanProductionFormat,
): ByosanProductionPlan {
	const evaluated = ByosanEvaluatedAngleSchema.parse(evaluatedInput);
	const freshnessDays = freshestPrimarySourceAgeDays(
		evaluated.candidate,
		currentDate,
	);
	const candidates: Array<{
		format: ByosanProductionFormat;
		score: number;
		eligible: boolean;
		reasons: string[];
		targetMinutes: number;
		minSegments: number;
		maxSegments: number;
	}> = [
		{
			format: "breaking",
			score:
				evaluated.scores.evidence * 0.45 +
				evaluated.scores.surprise * 0.4 +
				(freshnessDays !== null && freshnessDays <= 2 ? 15 : 0),
			eligible:
				freshnessDays !== null &&
				freshnessDays <= 2 &&
				evaluated.scores.evidence >= 80 &&
				evaluated.scores.surprise >= 65,
			reasons: [
				`freshest_primary_source_age_days=${freshnessDays ?? "unknown"}`,
				`evidence=${evaluated.scores.evidence}`,
				`surprise=${evaluated.scores.surprise}`,
			],
			targetMinutes: 6,
			minSegments: 20,
			maxSegments: 26,
		},
		{
			format: "comparison",
			score:
				evaluated.scores.counterfactual * 0.45 +
				evaluated.scores.audienceValue * 0.25 +
				evaluated.scores.visualizability * 0.3,
			eligible:
				evaluated.scores.counterfactual >= 75 &&
				evaluated.candidate.numbers.length >= 2,
			reasons: [
				`counterfactual=${evaluated.scores.counterfactual}`,
				`numbers=${evaluated.candidate.numbers.length}`,
				`visualizability=${evaluated.scores.visualizability}`,
			],
			targetMinutes: 8,
			minSegments: 24,
			maxSegments: 32,
		},
		{
			format: "deep_dive",
			score:
				evaluated.scores.mechanism * 0.4 +
				evaluated.scores.audienceValue * 0.35 +
				evaluated.scores.counterfactual * 0.25,
			eligible:
				evaluated.scores.mechanism >= 75 &&
				evaluated.scores.audienceValue >= 70,
			reasons: [
				`mechanism=${evaluated.scores.mechanism}`,
				`audience_value=${evaluated.scores.audienceValue}`,
				`counterfactual=${evaluated.scores.counterfactual}`,
			],
			targetMinutes: 10,
			minSegments: 28,
			maxSegments: 36,
		},
		{
			format: "regular",
			score: evaluated.weightedScore,
			eligible: true,
			reasons: [`weighted_score=${evaluated.weightedScore}`],
			targetMinutes: 6,
			minSegments: 20,
			maxSegments: 28,
		},
	];
	const ranked = candidates
		.filter((candidate) => candidate.eligible)
		.map((candidate) => ({
			...candidate,
			score: candidate.score + (candidate.format === preferredFormat ? 3 : 0),
		}))
		.sort(
			(left, right) =>
				right.score - left.score || left.format.localeCompare(right.format),
		);
	const selected = ranked[0];
	if (!selected) {
		throw new Error("BYOSAN_PRODUCTION_PLAN_UNAVAILABLE");
	}
	const archetype = selectByosanNarrativeArchetype(evaluated.candidate, {
		format: selected.format,
	});
	return ByosanProductionPlanSchema.parse({
		format: selected.format,
		targetMinutes: selected.targetMinutes,
		minSegments: selected.minSegments,
		maxSegments: selected.maxSegments,
		reasons: [...selected.reasons, `format_score=${selected.score.toFixed(2)}`],
		narrativeArchetype: archetype.archetype,
		archetypeRequiredSlots: archetype.requiredSlots,
		archetypeReasons: archetype.reasons,
		...(archetype.evidence ? { archetypeEvidence: archetype.evidence } : {}),
		...(selected.format === preferredFormat
			? { appliedPerformancePreference: preferredFormat }
			: {}),
	});
}

export const BYOSAN_COUNTERFACTUAL_TEST_MARKERS = [
	"除",
	"なければ",
	"場合",
	"without",
	"excluding",
	"分母",
	"差し引",
] as const;

export function evaluateByosanAngleCandidate(
	candidateInput: ByosanAngleCandidate,
	recentTitles: string[],
	publishedSourceUrls: ReadonlySet<string>,
	minWeightedScore: number,
): z.infer<typeof ByosanEvaluatedAngleSchema> {
	const candidate = ByosanAngleCandidateSchema.parse(candidateInput);
	const primaryCount = candidate.sources.filter((source) =>
		["L1", "L2", "L3"].includes(source.tier),
	).length;
	const publisherCount = distinctHosts(candidate.sources).size;
	const maxRecentSimilarity = recentTitles.reduce(
		(maximum, recentTitle) =>
			Math.max(
				maximum,
				byosanTextSimilarity(
					`${candidate.titleHook} ${candidate.topic} ${candidate.noveltyFingerprint}`,
					recentTitle,
				),
			),
		0,
	);

	const evidence = Math.min(
		100,
		primaryCount * 32 +
			Math.min(publisherCount, 3) * 12 +
			(candidate.sources.every((source) => source.supports.length > 0)
				? 16
				: 0),
	);
	const surprise = Math.min(
		100,
		concreteSignalCount(`${candidate.angle} ${candidate.counterfactual}`) * 12 +
			scoreTextDepth(candidate.hiddenMechanism, 36) * 0.45,
	);
	const mechanism = Math.min(
		100,
		scoreTextDepth(candidate.hiddenMechanism, 48) * 0.75 +
			concreteSignalCount(candidate.hiddenMechanism) * 8,
	);
	const counterfactual = Math.min(
		100,
		scoreTextDepth(candidate.counterfactual, 42) * 0.65 +
			(/(除|なければ|場合|without|excluding|分母|差し引)/i.test(
				candidate.counterfactual,
			)
				? 35
				: 0),
	);
	const audienceValue = Math.min(
		100,
		scoreTextDepth(candidate.audiencePayoff, 36) * 0.75 +
			(/(判断|見抜|使|比較|投資|家計|仕事|リスク)/.test(
				candidate.audiencePayoff,
			)
				? 25
				: 0),
	);
	const novelty = Math.max(0, 100 * (1 - maxRecentSimilarity));
	const visualizability = Math.min(
		100,
		candidate.numbers.length * 18 +
			concreteSignalCount(candidate.visualPlan) * 8 +
			scoreTextDepth(candidate.visualPlan, 32) * 0.4,
	);

	const scores = {
		evidence: Number(evidence.toFixed(2)),
		surprise: Number(surprise.toFixed(2)),
		mechanism: Number(mechanism.toFixed(2)),
		counterfactual: Number(counterfactual.toFixed(2)),
		audienceValue: Number(audienceValue.toFixed(2)),
		novelty: Number(novelty.toFixed(2)),
		visualizability: Number(visualizability.toFixed(2)),
	};
	const weightedScore =
		scores.evidence * 0.2 +
		scores.surprise * 0.15 +
		scores.mechanism * 0.15 +
		scores.counterfactual * 0.15 +
		scores.audienceValue * 0.15 +
		scores.novelty * 0.1 +
		scores.visualizability * 0.1;

	const hardGateFailures: string[] = [];
	if (primaryCount < 1) hardGateFailures.push("no_L1_L3_primary_source");
	if (candidate.numbers.length < 2)
		hardGateFailures.push("fewer_than_two_numbers");
	if (maxRecentSimilarity > 0.42)
		hardGateFailures.push("recent_topic_similarity_above_0_42");
	if (candidate.sources.some((source) => source.supports.length === 0))
		hardGateFailures.push("claim_source_mapping_missing");
	if (repeatsPublishedSource(candidate, publishedSourceUrls))
		hardGateFailures.push("source_already_published");
	const sourceIds = new Set(candidate.sources.map((source) => source.id));
	const adversarialIds = new Set<string>();
	for (const evidenceItem of candidate.adversarialEvidence) {
		if (adversarialIds.has(evidenceItem.id)) {
			hardGateFailures.push("duplicate_adversarial_evidence_id");
		}
		adversarialIds.add(evidenceItem.id);
		if (
			evidenceItem.sourceIds.some((sourceId) => !sourceIds.has(sourceId)) ||
			evidenceItem.checkedSourceIds.some((sourceId) => !sourceIds.has(sourceId))
		) {
			hardGateFailures.push("adversarial_evidence_source_missing");
		}
		if (
			evidenceItem.kind === "no_counter_evidence" &&
			evidenceItem.checkedSourceIds.length < 2
		) {
			hardGateFailures.push("no_counter_evidence_scope_too_narrow");
		}
	}
	if (candidate.adversarialEvidence.length < 1)
		hardGateFailures.push("adversarial_evidence_missing");
	if (weightedScore < minWeightedScore) {
		hardGateFailures.push(`weighted_score_below_${minWeightedScore}`);
	}

	return ByosanEvaluatedAngleSchema.parse({
		candidate,
		scores,
		weightedScore: Number(weightedScore.toFixed(2)),
		maxRecentSimilarity: Number(maxRecentSimilarity.toFixed(4)),
		hardGateFailures,
		passed: hardGateFailures.length === 0,
	});
}

export type ByosanAngleGate = {
	minCandidateCount: number;
	minDistinctPublishers: number;
	repeatWindowDays: number;
	minWeightedScore: number;
};

export function selectByosanAngle(
	candidateInputs: ByosanAngleCandidate[],
	recentTitles: string[],
	gate: ByosanAngleGate,
	publishedSourceUrls: ReadonlySet<string>,
): ByosanAngleDecision {
	const candidates = candidateInputs.map((candidate) =>
		ByosanAngleCandidateSchema.parse(candidate),
	);
	const available = candidates.filter(
		(candidate) => !repeatsPublishedSource(candidate, publishedSourceUrls),
	);
	const evaluated = candidates.map((candidate) =>
		evaluateByosanAngleCandidate(
			candidate,
			recentTitles,
			publishedSourceUrls,
			gate.minWeightedScore,
		),
	);
	const distinctPublishers = new Set(
		available.flatMap((candidate) => [...distinctHosts(candidate.sources)]),
	);
	const orthogonality = evaluateOrthogonality(available);
	const collectionFailures: string[] = [];
	if (available.length < gate.minCandidateCount)
		collectionFailures.push(`fewer_than_${gate.minCandidateCount}_candidates`);
	if (distinctPublishers.size < gate.minDistinctPublishers)
		collectionFailures.push(
			`fewer_than_${gate.minDistinctPublishers}_publishers_in_candidate_set`,
		);

	const ranked = evaluated
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => entry.passed)
		.sort(
			(left, right) =>
				right.entry.weightedScore - left.entry.weightedScore ||
				right.entry.scores.evidence - left.entry.scores.evidence ||
				right.entry.scores.counterfactual - left.entry.scores.counterfactual ||
				right.entry.scores.novelty - left.entry.scores.novelty,
		);
	const selectedIndex =
		collectionFailures.length === 0 ? (ranked[0]?.index ?? null) : null;
	return ByosanAngleDecisionSchema.parse({
		decision: selectedIndex === null ? "STOP" : "PASS",
		selectedIndex,
		reason:
			selectedIndex === null
				? [...collectionFailures, "no_candidate_passed_all_hard_gates"]
						.filter((reason, index, all) => all.indexOf(reason) === index)
						.join(",")
				: `candidate_${selectedIndex}_won_deterministic_ranking`,
		candidateCount: available.length,
		distinctPublisherCount: distinctPublishers.size,
		orthogonality,
		evaluated,
	});
}

function recentByosanRunDirs(
	root: string,
	currentDate: Date,
	days: number,
): string[] {
	const runsDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(runsDir)) return [];
	const cutoff = new Date(currentDate);
	cutoff.setUTCDate(cutoff.getUTCDate() - days);
	return fs
		.readdirSync(runsDir)
		.filter((runId) => /^\d{4}-\d{2}-\d{2}/.test(runId))
		.filter((runId) => {
			const date = new Date(`${runId.slice(0, 10)}T00:00:00Z`);
			return (
				!Number.isNaN(date.getTime()) && date >= cutoff && date <= currentDate
			);
		})
		.map((runId) => path.join(runsDir, runId));
}

export function loadPublishedByosanSourceUrls(
	root: string,
	currentDate: Date,
	days: number,
): Set<string> {
	return new Set(
		recentByosanRunDirs(root, currentDate, days)
			.filter(
				(runDir) =>
					fs.existsSync(path.join(runDir, "publish", "receipt.json")) &&
					fs.existsSync(path.join(runDir, "source", "feature_spec.json")),
			)
			.flatMap((runDir) =>
				PublishedRunSpecSchema.parse(
					fs.readJsonSync(path.join(runDir, "source", "feature_spec.json")),
				).sources.flatMap((source) => {
					const key = normalizedSourceUrl(source.url);
					return key === null ? [] : [key];
				}),
			),
	);
}

export function loadRecentByosanTitles(
	root: string,
	currentDate: Date,
	days = 30,
): string[] {
	return recentByosanRunDirs(root, currentDate, days).flatMap((runDir) => {
		const statePath = path.join(runDir, "state.json");
		if (!fs.existsSync(statePath)) return [];
		try {
			const state = fs.readJsonSync(statePath) as {
				metadata?: { title?: string };
				script?: { title?: string };
				director_data?: { angle?: string; search_query?: string };
			};
			return [
				[
					state.metadata?.title || state.script?.title || "",
					state.director_data?.angle || "",
					state.director_data?.search_query || "",
				]
					.filter(Boolean)
					.join(" "),
			].filter(Boolean);
		} catch {
			return [];
		}
	});
}
