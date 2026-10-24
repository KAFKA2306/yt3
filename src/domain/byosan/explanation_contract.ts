import type { Explanation } from "./explanation.js";
import {
	type ByosanFeatureSpec,
	type FeatureSpecIssue,
	GLOBAL_ISSUE_PATH,
	claimIssuePath,
	segmentIssuePath,
} from "./feature_spec.js";
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

type LocatedText = { path: string; text: string };

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

function specNumberTexts(spec: ByosanFeatureSpec): LocatedText[] {
	return [
		{ path: "title", text: spec.title },
		{ path: "thumbnailTitle", text: spec.thumbnailTitle },
		...Object.values(spec.thumbnail).map((text) => ({
			path: "thumbnail",
			text,
		})),
		{ path: "descriptionLead", text: spec.descriptionLead },
		...spec.descriptionBullets.map((text) => ({
			path: "descriptionBullets",
			text,
		})),
		...spec.hookPromises.map((text) => ({ path: "hookPromises", text })),
		...(spec.packaging?.relativeAnchor
			? [
					{ path: "packaging", text: spec.packaging.relativeAnchor.comparator },
					{ path: "packaging", text: spec.packaging.relativeAnchor.period },
				]
			: []),
		...spec.segments.flatMap((segment, index) =>
			[
				segment.headline,
				segment.subheadline,
				segment.text,
				...segment.stats.flatMap((stat) => [
					stat.label,
					stat.value,
					stat.detail,
				]),
			].map((text) => ({ path: segmentIssuePath(index), text })),
		),
	];
}

function unsourcedNumberIssues(
	texts: LocatedText[],
	sources: string[],
): FeatureSpecIssue[] {
	const normalizedSources = sources.map(nfkc);
	const seen = new Set<string>();
	return texts.flatMap(({ path, text }) =>
		(nfkc(text).replace(DATE_PATTERN, "").match(NUMBER_PATTERN) ?? []).flatMap(
			(token) => {
				if (seen.has(token)) return [];
				seen.add(token);
				if (normalizedSources.some((source) => source.includes(token))) {
					return [];
				}
				return [{ code: "unsourced_number", details: token, path }];
			},
		),
	);
}

function figureIssuePath(
	spec: ByosanFeatureSpec,
	figure: Explanation["figures"][number],
): string {
	const claimIndex = spec.claims.findIndex((claim) =>
		figureValueAppears(figure, [claim.claim]),
	);
	if (claimIndex < 0) return GLOBAL_ISSUE_PATH;
	const claimId = spec.claims[claimIndex]?.id;
	const segmentIndex = spec.segments.findIndex(
		(segment) => claimId !== undefined && segment.claimIds?.includes(claimId),
	);
	return segmentIndex < 0
		? claimIssuePath(claimIndex)
		: segmentIssuePath(segmentIndex);
}

export function auditFeatureSpecAgainstExplanation(
	spec: ByosanFeatureSpec,
	explanation: Explanation,
	candidate: Pick<ByosanAngleCandidate, "numbers">,
	bannedPhrases: string[],
): FeatureSpecIssue[] {
	const issues: FeatureSpecIssue[] = [];
	for (const figure of explanation.figures) {
		if (!figureValueAppears(figure, figureTexts(spec))) {
			issues.push({
				code: "explanation_figure_value_missing",
				details: figure.value,
				path: figureIssuePath(spec, figure),
			});
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
	issues.push(...unsourcedNumberIssues(specNumberTexts(spec), sources));
	for (const phrase of bannedPhrases) {
		const payoffIndex = spec.segments.findIndex(
			(segment) =>
				(segment.verificationRole === "resolution" ||
					segment.verificationRole === "landing") &&
				[segment.text, segment.headline, segment.subheadline]
					.map(nfkc)
					.some((text) => text.includes(nfkc(phrase))),
		);
		if (payoffIndex >= 0) {
			issues.push({
				code: "banned_phrase_in_resolution_or_landing",
				details: phrase,
				path: segmentIssuePath(payoffIndex),
			});
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
): FeatureSpecIssue[] {
	const normalizedNumbers = numbers.map(nfkc);
	return hookPromises
		.filter(
			(hook) =>
				!normalizedNumbers.some((number) => number.includes(nfkc(hook))),
		)
		.map((hook) => ({
			code: "hook_promise_not_in_candidate_numbers",
			details: hook,
			path: "hookPromises",
		}));
}
