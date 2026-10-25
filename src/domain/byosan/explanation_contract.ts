import type { Explanation } from "./explanation.js";
import {
	type ByosanFeatureSpec,
	type FeatureSpecIssue,
	GLOBAL_ISSUE_PATH,
	claimIssuePath,
	segmentIssuePath,
} from "./feature_spec.js";

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
		.replace(/(?<=\d)\s*[-–—〜~]\s*(?=\d)/g, "~")
		.replace(/[+\-−\s]/g, "");
}

const FIGURE_PATTERN = /([+\-−]?\d+(?:[.,]\d+)*)(%|円|ドル|倍|兆円|億円)/g;

export function figuresIn(
	text: string,
): Array<{ value: string; unit: string }> {
	return Array.from(nfkc(text).matchAll(FIGURE_PATTERN), (match) => ({
		value: match[1] ?? "",
		unit: match[2] ?? "",
	}));
}

export function figureValueAppears(
	figure: { value: string; unit: string },
	texts: string[],
): boolean {
	const normalizedTexts = texts.map(normalizeFigureText);
	const value = normalizeFigureText(figure.value);
	const unit = normalizeFigureText(figure.unit);
	if (!/\d/.test(value)) {
		return normalizedTexts.some((text) => text.includes(value));
	}
	const quantity = value.endsWith(unit) ? value : `${value}${unit}`;
	const pattern = new RegExp(
		`(?<![\\d.])${escapeRegExp(quantity)}(?!\\d|\\.\\d${/[a-z]$/i.test(quantity) ? "|[a-zA-Z]" : ""})`,
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
		...(spec.hookPromises ?? []).map((text) => ({
			path: "hookPromises",
			text,
		})),
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

function numberAppears(token: string, source: string): boolean {
	return new RegExp(`(?<![\\d.,])${escapeRegExp(token)}(?![.,]?\\d)`).test(
		source,
	);
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
				if (normalizedSources.some((source) => numberAppears(token, source))) {
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

export type NumberEvidence = { numbers: string[]; sourceText: string };

export function auditFeatureSpecAgainstExplanation(
	spec: ByosanFeatureSpec,
	explanation: Explanation,
	numberEvidence: NumberEvidence,
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
		...numberEvidence.numbers,
		numberEvidence.sourceText,
	];
	issues.push(...unsourcedNumberIssues(specNumberTexts(spec), sources));
	return issues;
}

export function explanationCheckItems(
	explanation: Pick<Explanation, "check">,
): string[] {
	return explanation.check.split("\n").filter((line) => line.length > 0);
}
