import { figureValueAppears, figuresIn } from "./explanation_contract.js";
import type { ByosanFeatureSegment } from "./feature_spec.js";

export type SpeechPlan = {
	maxSceneSeconds: number;
	charsPerSecond: number;
	minCueSeconds: number;
};

type CatchSegment = Pick<
	ByosanFeatureSegment,
	"claimIds" | "headline" | "text" | "stats"
>;

const charCount = (text: string): number => Array.from(text).length;

export function minimumCueSecondsAtAssPrecision(
	cues: ReadonlyArray<{ start: number; end: number }>,
): number {
	const centiseconds = cues.map(
		(cue) => Math.round(cue.end * 100) - Math.round(cue.start * 100),
	);
	return Math.min(...centiseconds) / 100;
}

export function evaluateOpeningCatch(input: {
	primaryClaimId: string;
	claims: ReadonlyArray<{ id?: string; claim: string }>;
	openingSegments: ReadonlyArray<CatchSegment>;
}): { passed: boolean; evidence: Record<string, unknown> } {
	const claim = input.claims.find(
		(candidate) => candidate.id === input.primaryClaimId,
	);
	if (!claim) {
		throw new Error(`BYOSAN_PRIMARY_CLAIM_MISSING: ${input.primaryClaimId}`);
	}
	const figures = figuresIn(claim.claim);
	const claimedInOpening = input.openingSegments.some((segment) =>
		segment.claimIds?.includes(input.primaryClaimId),
	);
	const matches = input.openingSegments.flatMap((segment, segmentIndex) => {
		const fields: Array<[string, string]> = [
			["text", segment.text],
			["headline", segment.headline],
			...segment.stats.map((stat): [string, string] => [
				"stats.value",
				stat.value,
			]),
		];
		return fields.flatMap(([field, text]) =>
			figures
				.filter((figure) => figureValueAppears(figure, [text]))
				.map((figure) => ({
					segment_index: segmentIndex,
					field,
					figure: `${figure.value}${figure.unit}`,
				})),
		);
	});
	const match = matches[0];
	return {
		passed: claimedInOpening && match !== undefined,
		evidence: {
			primary_claim_id: input.primaryClaimId,
			primary_claim_figures: figures.map(
				(figure) => `${figure.value}${figure.unit}`,
			),
			claimed_in_opening: claimedInOpening,
			match: match ?? null,
		},
	};
}

export function splitSpeechText(text: string, maxChars: number): string[] {
	const total = charCount(text);
	const count = Math.ceil(total / maxChars);
	if (count <= 1) return [text];
	const sentences = text
		.split(/(?<=[。！？])/u)
		.filter((sentence) => sentence.length > 0);
	const boundaries: number[] = [];
	let accumulated = 0;
	for (const sentence of sentences.slice(0, -1)) {
		accumulated += charCount(sentence);
		boundaries.push(accumulated);
	}
	const cuts: number[] = [];
	for (let part = 1; part < count; part++) {
		const target = (total * part) / count;
		const last = cuts.at(-1);
		const earliest = last === undefined ? 0 : last + 1;
		const [best] = boundaries
			.map((end, index) => ({ index, distance: Math.abs(end - target) }))
			.filter((candidate) => candidate.index >= earliest)
			.sort((left, right) => left.distance - right.distance);
		if (!best) {
			throw new Error(`BYOSAN_SCENE_SPLIT_IMPOSSIBLE: ${text}`);
		}
		cuts.push(best.index);
	}
	const starts = [0, ...cuts.map((cut) => cut + 1)];
	const stops = [...cuts.map((cut) => cut + 1), sentences.length];
	const parts = starts.map((start, part) =>
		sentences.slice(start, stops[part]).join(""),
	);
	if (parts.some((part) => charCount(part) > maxChars)) {
		throw new Error(`BYOSAN_SCENE_SENTENCE_TOO_LONG: ${text}`);
	}
	return parts;
}

export function planSpeechSegments(
	segments: ReadonlyArray<ByosanFeatureSegment>,
	plan: SpeechPlan,
): ByosanFeatureSegment[] {
	const maxChars = Math.floor(plan.maxSceneSeconds * plan.charsPerSecond);
	return segments.flatMap((segment) =>
		splitSpeechText(segment.text, maxChars).map((text, partIndex) => {
			if (charCount(text) / plan.charsPerSecond < plan.minCueSeconds) {
				throw new Error(`BYOSAN_SCENE_TOO_SHORT: ${text}`);
			}
			if (partIndex === 0) return { ...segment, text };
			const { chapter, ...shared } = segment;
			return { ...shared, stats: [], text };
		}),
	);
}
