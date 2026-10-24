import type { Explanation } from "./explanation.js";
import type { ByosanFeatureSpec } from "./feature_spec.js";
import type { ByosanAngleCandidate } from "./news_angle.js";

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}|\d+(?:年|月|日)/g;
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

const nfkc = (text: string): string => text.normalize("NFKC");

const escapeRegExp = (text: string): string =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeFigureText(text: string): string {
	return nfkc(text)
		.replace(/パーセント/g, "%")
		.replace(/プラス|マイナス/g, "")
		.replace(/(?<=\d),(?=\d{3}\b)/g, "")
		.replace(/[+\-−\s]/g, "");
}

export function figureValueAppears(
	figure: { value: string; unit: string },
	texts: string[],
): boolean {
	const normalizedTexts = texts.map(normalizeFigureText);
	const core = normalizeFigureText(figure.value).match(/\d+(?:\.\d+)?/)?.[0];
	if (core === undefined) {
		return normalizedTexts.some((text) =>
			text.includes(normalizeFigureText(figure.value)),
		);
	}
	const pattern = new RegExp(
		`(?<![\\d.])${escapeRegExp(core)}${escapeRegExp(normalizeFigureText(figure.unit))}(?!\\d|\\.\\d)`,
	);
	return normalizedTexts.some((text) => pattern.test(text));
}

function figureTexts(spec: ByosanFeatureSpec): string[] {
	return [
		spec.title,
		spec.thumbnailTitle,
		...Object.values(spec.thumbnail),
		...spec.segments.flatMap((segment) => [
			segment.text,
			segment.headline,
			...segment.stats.map((stat) => stat.value),
		]),
	];
}

function specNumberTexts(spec: ByosanFeatureSpec): string[] {
	return [
		spec.title,
		spec.thumbnailTitle,
		...Object.values(spec.thumbnail),
		spec.descriptionLead,
		...spec.descriptionBullets,
		...spec.hookPromises,
		...(spec.packaging?.relativeAnchor
			? [
					spec.packaging.relativeAnchor.comparator,
					spec.packaging.relativeAnchor.period,
				]
			: []),
		...spec.segments.flatMap((segment) => [
			segment.headline,
			segment.subheadline,
			segment.text,
			...segment.stats.flatMap((stat) => [stat.label, stat.value, stat.detail]),
		]),
	];
}

function unsourcedNumbers(texts: string[], sources: string[]): string[] {
	const tokens = texts.flatMap(
		(text) => nfkc(text).replace(DATE_PATTERN, "").match(NUMBER_PATTERN) ?? [],
	);
	const normalizedSources = sources.map(nfkc);
	return [...new Set(tokens)].filter(
		(token) => !normalizedSources.some((source) => source.includes(token)),
	);
}

export function auditFeatureSpecAgainstExplanation(
	spec: ByosanFeatureSpec,
	explanation: Explanation,
	candidate: Pick<ByosanAngleCandidate, "numbers">,
	bannedPhrases: string[],
): string[] {
	const payoffSegments = spec.segments.filter(
		(segment) =>
			segment.verificationRole === "resolution" ||
			segment.verificationRole === "landing",
	);
	const payoffTexts = payoffSegments.flatMap((segment) =>
		[segment.text, segment.headline, segment.subheadline].map(nfkc),
	);
	const issues: string[] = [];
	for (const figure of explanation.figures) {
		if (!figureValueAppears(figure, figureTexts(spec))) {
			issues.push(`explanation_figure_value_missing: ${figure.value}`);
		}
	}
	const sources = [
		...explanation.figures.map((figure) => figure.value),
		...candidate.numbers,
		...spec.claims.flatMap((claim) =>
			claim.confidence === undefined
				? []
				: [String(Math.round(claim.confidence * 100))],
		),
	];
	for (const token of unsourcedNumbers(specNumberTexts(spec), sources)) {
		issues.push(`unsourced_number: ${token}`);
	}
	for (const phrase of bannedPhrases) {
		if (payoffTexts.some((text) => text.includes(nfkc(phrase)))) {
			issues.push(`banned_phrase_in_resolution_or_landing: ${phrase}`);
		}
	}
	return issues;
}

const FIGURE_FRAGMENT = /[+\-−]?\d+(?:[.,]\d+)*(?:%|円|ドル|倍|兆円|億円)/;

export function normalizeHookPromise(hook: string, maxChars: number): string {
	const text = nfkc(hook);
	if ([...text].length <= maxChars) return text;
	return text.match(FIGURE_FRAGMENT)?.[0] ?? text;
}

export function auditHookPromises(
	hookPromises: string[],
	numbers: string[],
): string[] {
	const normalizedNumbers = numbers.map(nfkc);
	return hookPromises
		.filter(
			(hook) =>
				!normalizedNumbers.some((number) => number.includes(nfkc(hook))),
		)
		.map((hook) => `hook_promise_not_in_candidate_numbers: ${hook}`);
}
