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

function cutSentences(
	sentences: string[],
	ends: number[],
	total: number,
	count: number,
	maxChars: number,
): string[] | undefined {
	const parts: string[] = [];
	let first = 0;
	let consumed = 0;
	for (let part = 1; part < count; part++) {
		const target = (total * part) / count;
		const candidate = ends
			.map((end, index) => ({ index, end }))
			.filter(
				({ index, end }) =>
					index >= first &&
					index < sentences.length - 1 &&
					end - consumed <= maxChars &&
					total - end <= maxChars * (count - part),
			)
			.sort(
				(left, right) =>
					Math.abs(left.end - target) - Math.abs(right.end - target),
			)[0];
		if (!candidate) return undefined;
		parts.push(sentences.slice(first, candidate.index + 1).join(""));
		consumed = candidate.end;
		first = candidate.index + 1;
	}
	parts.push(sentences.slice(first).join(""));
	return parts;
}

export function splitSpeechText(text: string, maxChars: number): string[] {
	const total = charCount(text);
	if (total <= maxChars) return [text];
	const sentences = text
		.split(/(?<=[。！？])/u)
		.filter((sentence) => sentence.length > 0);
	const ends = sentences.map((_, index) =>
		charCount(sentences.slice(0, index + 1).join("")),
	);
	for (
		let count = Math.ceil(total / maxChars);
		count <= sentences.length;
		count++
	) {
		const parts = cutSentences(sentences, ends, total, count, maxChars);
		if (parts) return parts;
	}
	throw new Error(`BYOSAN_SCENE_SPLIT_IMPOSSIBLE: ${text}`);
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

export function layoutCueSpans(
	weights: readonly number[],
	start: number,
	end: number,
	minCueSeconds: number,
): Array<{ start: number; end: number }> {
	const window = end - start;
	if (window < weights.length * minCueSeconds) {
		throw new Error(
			`BYOSAN_CUE_WINDOW_TOO_SHORT: ${weights.length} cues in ${window.toFixed(2)}s`,
		);
	}
	const totalAt = (rate: number): number =>
		weights.reduce(
			(sum, weight) => sum + Math.max(minCueSeconds, rate * weight),
			0,
		);
	let low = 0;
	let high = window;
	for (let step = 0; step < 200; step++) {
		const middle = (low + high) / 2;
		if (totalAt(middle) < window) {
			low = middle;
		} else {
			high = middle;
		}
	}
	const durations = weights.map((weight) =>
		Math.max(minCueSeconds, high * weight),
	);
	let cursor = start;
	return durations.map((duration, index) => {
		const spanEnd = index === durations.length - 1 ? end : cursor + duration;
		const span = { start: cursor, end: spanEnd };
		cursor = spanEnd;
		return span;
	});
}
