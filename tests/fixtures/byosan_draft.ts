import fs from "fs-extra";
import type {
	FeatureDraftInput,
	Json,
} from "../../src/domain/byosan/feature_draft.js";

const REFERENCE = "config/productions/sp500_anthropic_2026q2.json";

type Reference = {
	schemaVersion: string;
	runId: string;
	asOf: string;
	title: string;
	sources: { id: string; name: string; url: string }[];
	claims: { claim: string; sourceIds: string[]; status: string }[];
	[key: string]: unknown;
};

const strings = (value: unknown): string[] =>
	typeof value === "string"
		? [value]
		: Array.isArray(value)
			? value.flatMap(strings)
			: typeof value === "object" && value !== null
				? Object.values(value).flatMap(strings)
				: [];

export function fixtureDraft(): Json {
	const reference = fs.readJsonSync(REFERENCE) as Reference;
	const claims = reference.claims.map((claim, index) => ({
		...claim,
		id: `claim_${index}`,
	}));
	const { schemaVersion: _a, runId: _b, asOf: _c, ...script } = reference;
	return {
		...script,
		claims,
		title: "S&P500利益47.4%増の正体｜評価益を除くと何が残るか | 秒算マネー",
		packaging: {
			primaryClaimId: "claim_0",
			claimIds: claims.slice(0, 6).map((claim) => claim.id),
		},
		explanation: {
			conclusion: "S&P 500の利益成長率は47.4%、AlphabetとAmazonを除くと28.8%。",
			principle: "巨大企業の評価益が指数全体の利益成長率を押し上げている。",
			figures: [
				{
					metric: "S&P 500 Q2ブレンデッド利益成長率",
					population: "S&P 500",
					period: "2026年Q2",
					unit: "%",
					value: "47.4%",
					quote: claims[0]?.claim ?? "",
					kind: "actual",
				},
				{
					metric: "AlphabetとAmazonを除く利益成長率",
					population: "S&P 500",
					period: "2026年Q2",
					unit: "%",
					value: "28.8%",
					quote: claims[0]?.claim ?? "",
					kind: "actual",
				},
			],
			check: "評価益を除いた成長率を確認する。",
		},
	};
}

export function fixtureInput(
	publishedUrls: ReadonlySet<string> = new Set(),
): FeatureDraftInput {
	const reference = fs.readJsonSync(REFERENCE) as Reference;
	const body = strings(reference).join("\n");
	return {
		runId: "byosan_money/2026-10-25-daily",
		asOf: "2026-10-25",
		today: reference.sources.map((source) => ({
			title: source.name,
			url: source.url,
			issuer: "fixture",
			published: "2026-10-24",
			body,
		})),
		baseline: [],
		publishedUrls,
	};
}
