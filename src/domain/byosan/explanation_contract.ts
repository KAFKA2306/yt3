import type { Explanation } from "./explanation.js";
import {
	type ByosanFeatureSpec,
	type FeatureSpecIssue,
	claimIssuePath,
	segmentIssuePath,
} from "./feature_spec.js";

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}|\d+(?:年|月|日)/g;
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

const nfkc = (text: string): string => text.normalize("NFKC");

type LocatedText = { path: string; text: string };

function specNumberTexts(spec: ByosanFeatureSpec): LocatedText[] {
	return [
		{ path: "title", text: spec.title },
		{ path: "thumbnailTitle", text: spec.thumbnailTitle },
		...Object.values(spec.thumbnail).map((text) => ({
			path: "thumbnail",
			text,
		})),
		{ path: "descriptionLead", text: spec.descriptionLead },
		...spec.claims.map((claim, index) => ({
			path: claimIssuePath(index),
			text: claim.claim,
		})),
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
	return new RegExp(
		`(?<![\\d.,])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![.,]?\\d)`,
	).test(source);
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

export function auditFeatureSpecAgainstExplanation(
	spec: ByosanFeatureSpec,
	explanation: Explanation,
	sourceText: string,
): FeatureSpecIssue[] {
	return unsourcedNumberIssues(specNumberTexts(spec), [
		...explanation.figures.map((figure) => figure.value),
		sourceText,
	]);
}

export function explanationCheckItems(
	explanation: Pick<Explanation, "check">,
): string[] {
	return explanation.check.split("\n").filter((line) => line.length > 0);
}
