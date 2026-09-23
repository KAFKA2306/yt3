import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

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

export const ByosanAngleSourceSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(2),
	url: z.string().url(),
	publishedAt: z.string().min(4).optional(),
	tier: ByosanSourceTierSchema,
	// Some providers serialize a single claim mapping as a string. Normalize
	// that losslessly at the schema boundary; missing mappings still fail closed.
	supports: ByosanSourceSupportsSchema,
});

export const ByosanExplorationProfileSchema = z.object({
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

export type ByosanExplorationProfile = z.infer<
	typeof ByosanExplorationProfileSchema
>;

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
});

export type ByosanAngleCandidate = z.infer<typeof ByosanAngleCandidateSchema>;

export const ByosanAngleScoresSchema = z.object({
	evidence: z.number().min(0).max(100),
	surprise: z.number().min(0).max(100),
	mechanism: z.number().min(0).max(100),
	counterfactual: z.number().min(0).max(100),
	audienceValue: z.number().min(0).max(100),
	novelty: z.number().min(0).max(100),
	visualizability: z.number().min(0).max(100),
});

export const ByosanEvaluatedAngleSchema = z.object({
	candidate: ByosanAngleCandidateSchema,
	scores: ByosanAngleScoresSchema,
	weightedScore: z.number().min(0).max(100),
	maxRecentSimilarity: z.number().min(0).max(1),
	hardGateFailures: z.array(z.string()),
	passed: z.boolean(),
});

export const ByosanAngleDecisionSchema = z.object({
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

const ORTHOGONALITY_AXES = [
	"geography",
	"sector",
	"actorType",
	"eventType",
	"timeHorizon",
	"causalDirection",
	"financialMetric",
	"supplyChainLayer",
	"marketRealEconomy",
	"dataSurface",
	"scale",
] as const satisfies readonly (keyof ByosanExplorationProfile)[];

type Orthogonality = z.infer<typeof ByosanAngleDecisionSchema>["orthogonality"];

function evaluateOrthogonality(
	candidates: ByosanAngleCandidate[],
): Orthogonality {
	const diversity = Object.fromEntries(
		ORTHOGONALITY_AXES.map((axis) => [
			axis,
			new Set(candidates.map((candidate) => candidate.explorationProfile[axis]))
				.size,
		]),
	) as Record<(typeof ORTHOGONALITY_AXES)[number], number>;
	const uniqueProfileCount = new Set(
		candidates.map((candidate) =>
			ORTHOGONALITY_AXES.map((axis) => candidate.explorationProfile[axis]).join(
				"\u001f",
			),
		),
	).size;
	const minimums: Record<(typeof ORTHOGONALITY_AXES)[number], number> = {
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
	};
	const failedAxes = ORTHOGONALITY_AXES.filter(
		(axis) => diversity[axis] < Math.min(minimums[axis], candidates.length),
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

export function evaluateByosanAngleCandidate(
	candidateInput: ByosanAngleCandidate,
	recentTitles: string[],
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
	if (publisherCount < 2) hardGateFailures.push("fewer_than_two_publishers");
	if (candidate.numbers.length < 2)
		hardGateFailures.push("fewer_than_two_numbers");
	if (maxRecentSimilarity > 0.42)
		hardGateFailures.push("recent_topic_similarity_above_0_42");
	if (
		!/(除|なければ|場合|without|excluding|分母|差し引)/i.test(
			candidate.counterfactual,
		)
	)
		hardGateFailures.push("counterfactual_is_not_testable");
	if (candidate.sources.some((source) => source.supports.length === 0))
		hardGateFailures.push("claim_source_mapping_missing");
	if (weightedScore < 75) hardGateFailures.push("weighted_score_below_75");

	return ByosanEvaluatedAngleSchema.parse({
		candidate,
		scores,
		weightedScore: Number(weightedScore.toFixed(2)),
		maxRecentSimilarity: Number(maxRecentSimilarity.toFixed(4)),
		hardGateFailures,
		passed: hardGateFailures.length === 0,
	});
}

export function selectByosanAngle(
	candidateInputs: ByosanAngleCandidate[],
	recentTitles: string[],
): ByosanAngleDecision {
	const candidates = candidateInputs.map((candidate) =>
		ByosanAngleCandidateSchema.parse(candidate),
	);
	const evaluated = candidates.map((candidate) =>
		evaluateByosanAngleCandidate(candidate, recentTitles),
	);
	const distinctPublishers = new Set(
		candidates.flatMap((candidate) => [...distinctHosts(candidate.sources)]),
	);
	const orthogonality = evaluateOrthogonality(candidates);
	const collectionFailures: string[] = [];
	if (candidates.length < 5)
		collectionFailures.push("fewer_than_five_candidates");
	if (distinctPublishers.size < 3)
		collectionFailures.push("fewer_than_three_publishers_in_candidate_set");
	collectionFailures.push(...orthogonality.failedAxes);

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
		candidateCount: candidates.length,
		distinctPublisherCount: distinctPublishers.size,
		orthogonality,
		evaluated,
	});
}

export function loadRecentByosanTitles(
	root: string,
	currentDate: Date,
	days = 30,
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
		.flatMap((runId) => {
			const statePath = path.join(runsDir, runId, "state.json");
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
