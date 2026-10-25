import type { ByosanFeatureSegment } from "./feature_spec.js";

export type SpeechPlan = {
	maxSceneSeconds: number;
	charsPerSecond: number;
};

const charCount = (text: string): number => Array.from(text).length;

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
	for (const boundary of [/(?<=[。！？])/u, /(?<=[。！？、])/u]) {
		const sentences = text
			.split(boundary)
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
	}
	const chars = Array.from(text);
	return Array.from({ length: Math.ceil(total / maxChars) }, (_, index) =>
		chars.slice(index * maxChars, (index + 1) * maxChars).join(""),
	);
}

export function planSpeechSegments(
	segments: ReadonlyArray<ByosanFeatureSegment>,
	plan: SpeechPlan,
): ByosanFeatureSegment[] {
	const maxChars = Math.floor(plan.maxSceneSeconds * plan.charsPerSecond);
	return segments.flatMap((segment) =>
		splitSpeechText(segment.text, maxChars).map((text, partIndex) =>
			partIndex === 0 ? { ...segment, text } : { ...segment, stats: [], text },
		),
	);
}

export function planSpeechParts(
	segments: readonly ByosanFeatureSegment[],
	plan: SpeechPlan,
): Array<{
	segment: ByosanFeatureSegment;
	segmentIndex: number;
	partIndex: number;
}> {
	return segments.flatMap((segment, segmentIndex) =>
		planSpeechSegments([segment], plan).map((part, partIndex) => ({
			segment: part,
			segmentIndex,
			partIndex,
		})),
	);
}

export function layoutCueSpans(
	weights: readonly number[],
	start: number,
	end: number,
	minCueSeconds: number,
): Array<{ start: number; end: number }> {
	const window = end - start;
	const floor = Math.min(minCueSeconds, window / weights.length);
	const totalAt = (rate: number): number =>
		weights.reduce((sum, weight) => sum + Math.max(floor, rate * weight), 0);
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
	const durations = weights.map((weight) => Math.max(floor, high * weight));
	let cursor = start;
	return durations.map((duration, index) => {
		const spanEnd = index === durations.length - 1 ? end : cursor + duration;
		const span = { start: cursor, end: spanEnd };
		cursor = spanEnd;
		return span;
	});
}
