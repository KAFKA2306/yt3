import { z } from "zod";
import { ungroundedFigureValues } from "./explanation.js";
import { auditFeatureSpecAgainstExplanation } from "./explanation_contract.js";
import {
	ByosanFeatureDraftSchema,
	ByosanFeatureSpecSchema,
	type FeatureSpecIssue,
	GLOBAL_ISSUE_PATH,
	auditByosanFeatureSpec,
	ensureByosanBrandTag,
} from "./feature_spec.js";
import { normalizedSourceUrl } from "./published_sources.js";

export type Json = Record<string, unknown>;

export const DraftArticlesSchema = z.array(
	z.object({
		title: z.string().min(1),
		url: z.string().url(),
		issuer: z.string().min(1),
		published: z.string().min(1),
		body: z.string().min(1),
	}),
);

type DraftArticle = z.infer<typeof DraftArticlesSchema>[number];

export type FeatureDraftInput = {
	runId: string;
	asOf: string;
	today: DraftArticle[];
	baseline: DraftArticle[];
	publishedUrls: ReadonlySet<string>;
};

type FeatureCorrection = {
	path: string;
	rule: "stat_value" | "event_date" | "segment_source";
	from: unknown;
	to: unknown;
};

const isPublished = (
	article: DraftArticle,
	published: ReadonlySet<string>,
): boolean => {
	const key = normalizedSourceUrl(article.url);
	return key !== null && published.has(key);
};

export function prepareFeatureDraftInput(
	input: FeatureDraftInput,
): FeatureDraftInput {
	const today = input.today.filter(
		(article) => !isPublished(article, input.publishedUrls),
	);
	if (today.length === 0) {
		throw new Error(
			"BYOSAN_ANGLE_STOP: no unpublished articles in registered sources",
		);
	}
	const seen = new Set(today.map((article) => article.url));
	return {
		...input,
		today,
		baseline: input.baseline.filter(
			(article) =>
				!seen.has(article.url) && !isPublished(article, input.publishedUrls),
		),
	};
}

const renderArticles = (articles: DraftArticle[]): string =>
	articles
		.map(
			(article) =>
				`## ${article.title}\n- 媒体: ${article.issuer}\n- 公開: ${article.published}\n- URL: ${article.url}\n\n${article.body}`,
		)
		.join("\n\n");

export function renderFeatureDraftInput(input: FeatureDraftInput): string {
	return `[今日の新着記事]\n${renderArticles(input.today)}\n\n[背景（直近の記事）]\n${renderArticles(input.baseline)}`;
}

function inputArticles(input: FeatureDraftInput): DraftArticle[] {
	return [...input.today, ...input.baseline];
}

export function inputSourceText(input: FeatureDraftInput): string {
	return inputArticles(input)
		.map((article) => `${article.title}\n${article.body}`)
		.join("\n\n");
}

export function isJson(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function correct<T>(
	corrections: FeatureCorrection[],
	path: string,
	rule: FeatureCorrection["rule"],
	from: T,
	to: T,
): T {
	if (from !== to) corrections.push({ path, rule, from, to });
	return to;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_PARTS = /^(\d{4})\D?(\d{1,2})\D?(\d{1,2})\D*$/;

function isoDateOf(value: string): string | undefined {
	const parts = DATE_PARTS.exec(value.normalize("NFKC").trim());
	if (!parts) return undefined;
	const year = Number(parts[1]);
	const month = Number(parts[2]);
	const day = Number(parts[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	const valid =
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day;
	if (!valid) return undefined;
	return `${parts[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizePackaging(
	packaging: unknown,
	corrections: FeatureCorrection[],
): unknown {
	if (!isJson(packaging) || !isJson(packaging.freshness)) return packaging;
	const eventDate = packaging.freshness.eventDate;
	if (typeof eventDate !== "string" || ISO_DATE.test(eventDate)) {
		return packaging;
	}
	const isoDate = isoDateOf(eventDate);
	if (isoDate === undefined) return packaging;
	return {
		...packaging,
		freshness: {
			...packaging.freshness,
			eventDate: correct(
				corrections,
				"packaging.freshness.eventDate",
				"event_date",
				eventDate,
				isoDate,
			),
		},
	};
}

function normalizeSegment(
	segment: unknown,
	index: number,
	context: {
		sourceNameById: Map<string, string>;
		sourceIdsByClaimId: Map<string, unknown[]>;
	},
	corrections: FeatureCorrection[],
): unknown {
	if (!isJson(segment)) return segment;
	let next: Json = segment;
	if (Array.isArray(segment.stats)) {
		next = {
			...next,
			stats: segment.stats.map((stat, statIndex) =>
				isJson(stat) && typeof stat.value === "string"
					? {
							...stat,
							value: correct(
								corrections,
								`segments[${index}].stats[${statIndex}].value`,
								"stat_value",
								stat.value,
								stat.value.normalize("NFKC"),
							),
						}
					: stat,
			),
		};
	}
	if (typeof segment.source === "string" && segment.source.length < 2) {
		const claimIds = Array.isArray(next.claimIds) ? next.claimIds : [];
		const firstClaimSourceId = claimIds
			.map((id) =>
				typeof id === "string" ? context.sourceIdsByClaimId.get(id) : undefined,
			)
			.find((sourceIds) => sourceIds !== undefined)?.[0];
		const name =
			typeof firstClaimSourceId === "string"
				? context.sourceNameById.get(firstClaimSourceId)
				: undefined;
		if (name !== undefined) {
			next = {
				...next,
				source: correct(
					corrections,
					`segments[${index}].source`,
					"segment_source",
					segment.source,
					name,
				),
			};
		}
	}
	return next;
}

export function normalizeFeatureDraft(raw: Json): {
	draft: Json;
	corrections: FeatureCorrection[];
} {
	const corrections: FeatureCorrection[] = [];
	const packaging = normalizePackaging(raw.packaging, corrections);
	const claims = Array.isArray(raw.claims) ? raw.claims.filter(isJson) : [];
	const sourceIdsByClaimId = new Map<string, unknown[]>(
		claims.flatMap((claim) =>
			typeof claim.id === "string" && Array.isArray(claim.sourceIds)
				? [[claim.id, claim.sourceIds]]
				: [],
		),
	);
	const sourceNameById = new Map<string, string>(
		(Array.isArray(raw.sources) ? raw.sources.filter(isJson) : []).flatMap(
			(source) =>
				typeof source.id === "string" && typeof source.name === "string"
					? [[source.id, source.name]]
					: [],
		),
	);
	const segments = Array.isArray(raw.segments)
		? raw.segments.map((segment, index) =>
				normalizeSegment(
					segment,
					index,
					{ sourceNameById, sourceIdsByClaimId },
					corrections,
				),
			)
		: raw.segments;
	return { draft: { ...raw, packaging, segments }, corrections };
}

export function buildFeatureSpecInput(
	draft: z.infer<typeof ByosanFeatureDraftSchema>,
	context: Pick<FeatureDraftInput, "runId" | "asOf">,
): unknown {
	const { explanation: _explanation, ...script } = draft;
	return {
		...script,
		tags: ensureByosanBrandTag(draft.tags),
		schemaVersion: "byosan_feature_v1",
		runId: context.runId,
		asOf: context.asOf,
	};
}

function zodIssues(error: z.ZodError): FeatureSpecIssue[] {
	return error.issues.map((issue) => ({
		code: `schema_${issue.code}`,
		details: `${issue.path.map(String).join(".")}: ${issue.message}`,
		path: GLOBAL_ISSUE_PATH,
	}));
}

export function featureDraftIssues(
	draft: Json,
	input: FeatureDraftInput,
): FeatureSpecIssue[] {
	const parsed = ByosanFeatureDraftSchema.safeParse(draft);
	if (!parsed.success) return zodIssues(parsed.error);
	const spec = ByosanFeatureSpecSchema.safeParse(
		buildFeatureSpecInput(parsed.data, input),
	);
	if (!spec.success) return zodIssues(spec.error);
	const inputUrls = new Set(
		inputArticles(input).map((article) => normalizedSourceUrl(article.url)),
	);
	const sourceIssues = spec.data.sources.flatMap((source) => {
		const key = normalizedSourceUrl(source.url);
		if (inputUrls.has(key)) return [];
		return [
			{
				code:
					key !== null && input.publishedUrls.has(key)
						? "source_already_published"
						: "source_not_in_input",
				details: source.url,
				path: GLOBAL_ISSUE_PATH,
			},
		];
	});
	return [
		...sourceIssues,
		...ungroundedFigureValues(
			parsed.data.explanation,
			inputArticles(input).map((article) => article.body),
		).map((details) => ({
			code: "figure_not_grounded",
			details,
			path: GLOBAL_ISSUE_PATH,
		})),
		...auditByosanFeatureSpec(spec.data),
		...auditFeatureSpecAgainstExplanation(
			spec.data,
			parsed.data.explanation,
			inputSourceText(input),
		),
	];
}

export function summarizeFeatureIssues(issues: FeatureSpecIssue[]): string {
	return issues.map((issue) => `${issue.code}=${issue.details}`).join("; ");
}
