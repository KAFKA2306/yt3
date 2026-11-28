import type { Explanation } from "./explanation.js";
import {
	type ByosanFeatureSpec,
	claimIssuePath,
	type FeatureSpecIssue,
	segmentIssuePath,
} from "./feature_spec.js";
import {
	BYOSAN_NUMBER_PATTERN,
	canonicalNumber,
} from "./number_canonicalization.js";

const DATE_PATTERN =
	/\d{4}-\d{2}-\d{2}|\d{1,2}[〜～–-]\d{1,2}月|\d+(?:年|月|日)/gu;
const WRITTEN_NUMBER_WORDS: Record<string, RegExp> = {
	"1": /\b(?:one|first)\b/iu,
	"2": /\b(?:two|second|double|twice)\b/iu,
	"3": /\b(?:three|third)\b/iu,
	"4": /\b(?:four|fourth)\b/iu,
	"5": /\b(?:five|fifth)\b/iu,
	"6": /\b(?:six|sixth)\b/iu,
	"7": /\b(?:seven|seventh)\b/iu,
	"8": /\b(?:eight|eighth)\b/iu,
	"9": /\b(?:nine|ninth)\b/iu,
	"10": /\b(?:ten|tenth)\b/iu,
};

const nfkc = (text: string): string => text.normalize("NFKC");

type LocatedText = { path: string; text: string };

function specNumberTexts(spec: ByosanFeatureSpec): LocatedText[] {
	return [
		{ path: "title", text: spec.title },
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

function numberTokens(text: string): string[] {
	return (
		nfkc(text).replace(DATE_PATTERN, "").match(BYOSAN_NUMBER_PATTERN) ?? []
	);
}

function numberAppears(token: string, source: string): boolean {
	if (
		numberTokens(source).some(
			(sourceToken) => canonicalNumber(sourceToken) === canonicalNumber(token),
		)
	)
		return true;
	if (WRITTEN_NUMBER_WORDS[canonicalNumber(token)]?.test(source)) return true;
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
		(
			nfkc(text).replace(DATE_PATTERN, "").match(BYOSAN_NUMBER_PATTERN) ?? []
		).flatMap((token) => {
			if (seen.has(token)) return [];
			seen.add(token);
			if (normalizedSources.some((source) => numberAppears(token, source))) {
				return [];
			}
			return [{ code: "unsourced_number", details: token, path }];
		}),
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
