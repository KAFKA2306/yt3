import type { z } from "zod";
import type { ByosanActiveProbeEvidence } from "./active_probe.js";
import type { Explanation } from "./explanation.js";
import {
	type NumberEvidence,
	auditFeatureSpecAgainstExplanation,
} from "./explanation_contract.js";
import {
	ByosanFeatureDraftSchema,
	type ByosanFeatureSource,
	type ByosanFeatureSpec,
	ByosanFeatureSpecSchema,
	type FeatureSpecIssue,
	GLOBAL_ISSUE_PATH,
	SEGMENT_CLAIM_IDS_MAX,
	auditByosanFeatureSpec,
	claimIssuePath,
	ensureByosanBrandTag,
	segmentIssuePath,
} from "./feature_spec.js";

export type Json = Record<string, unknown>;

export type FeatureDraftContext = {
	runId: string;
	asOf: string;
	angle: string;
	searchQuery: string;
	production: ByosanFeatureSpec["production"];
	narrative: ByosanFeatureSpec["narrative"];
	adversarialEvidence: ByosanFeatureSpec["adversarialEvidence"];
	activeProbes: ByosanActiveProbeEvidence[];
	sources: ByosanFeatureSource[];
	explanation: Explanation;
	numberEvidence: NumberEvidence;
};

type FeatureCorrectionRule =
	| "stat_value"
	| "event_date"
	| "claim_ids"
	| "segment_source";

type FeatureCorrection = {
	path: string;
	rule: FeatureCorrectionRule;
	from: unknown;
	to: unknown;
};

type NormalizedFeatureDraft = {
	draft: Json;
	corrections: FeatureCorrection[];
};

type FeatureRepairRound = {
	round: number;
	units: string[];
	issueCodes: string[];
};

const COLLECTION_KEYS = ["segments", "claims"];
const INDEXED_UNIT = /^(segments|claims)\[(\d+)\]$/;
const DRAFT_SHAPE: Record<string, z.ZodType> = ByosanFeatureDraftSchema.shape;

export function isJson(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function correct<T>(
	corrections: FeatureCorrection[],
	path: string,
	rule: FeatureCorrectionRule,
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

function keepPrimaryClaimIds(ids: unknown[], primary: Set<string>): unknown[] {
	const ranked = [...ids].sort(
		(left, right) =>
			Number(!(typeof left === "string" && primary.has(left))) -
			Number(!(typeof right === "string" && primary.has(right))),
	);
	const kept = new Set(ranked.slice(0, SEGMENT_CLAIM_IDS_MAX));
	return ids.filter((id) => kept.has(id));
}

function normalizeSegment(
	segment: unknown,
	index: number,
	context: {
		primary: Set<string>;
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
	if (Array.isArray(segment.claimIds)) {
		const claimIds = segment.claimIds;
		const trimmed =
			claimIds.length > SEGMENT_CLAIM_IDS_MAX
				? keepPrimaryClaimIds(claimIds, context.primary)
				: claimIds;
		if (trimmed !== claimIds) {
			corrections.push({
				path: `segments[${index}].claimIds`,
				rule: "claim_ids",
				from: claimIds,
				to: trimmed,
			});
		}
		next = { ...next, claimIds: trimmed };
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

export function normalizeFeatureDraft(
	raw: Json,
	sources: ByosanFeatureSource[],
): NormalizedFeatureDraft {
	const corrections: FeatureCorrection[] = [];
	const packaging = normalizePackaging(raw.packaging, corrections);
	const primary = new Set<string>(
		isJson(packaging) && typeof packaging.primaryClaimId === "string"
			? [packaging.primaryClaimId]
			: [],
	);
	if (isJson(packaging) && Array.isArray(packaging.claimIds)) {
		for (const id of packaging.claimIds) {
			if (typeof id === "string") primary.add(id);
		}
	}
	const claims = Array.isArray(raw.claims) ? raw.claims.filter(isJson) : [];
	const sourceIdsByClaimId = new Map<string, unknown[]>(
		claims.flatMap((claim) =>
			typeof claim.id === "string" && Array.isArray(claim.sourceIds)
				? [[claim.id, claim.sourceIds]]
				: [],
		),
	);
	const sourceNameById = new Map(
		sources.map((source) => [source.id, source.name]),
	);
	const segments = Array.isArray(raw.segments)
		? raw.segments.map((segment, index) =>
				normalizeSegment(
					segment,
					index,
					{ primary, sourceNameById, sourceIdsByClaimId },
					corrections,
				),
			)
		: raw.segments;
	return {
		draft: { ...raw, packaging, segments },
		corrections,
	};
}

function zodIssuePath(path: ReadonlyArray<PropertyKey>): string {
	const [key, index] = path;
	if (typeof key !== "string") return GLOBAL_ISSUE_PATH;
	if (COLLECTION_KEYS.includes(key)) {
		return typeof index === "number" ? `${key}[${index}]` : GLOBAL_ISSUE_PATH;
	}
	return key in DRAFT_SHAPE ? key : GLOBAL_ISSUE_PATH;
}

function zodIssues(error: z.ZodError): FeatureSpecIssue[] {
	return error.issues.map((issue) => ({
		code: `schema_${issue.code}`,
		details: `${issue.path.map(String).join(".")}: ${issue.message}`,
		path: zodIssuePath(issue.path),
	}));
}

export function buildFeatureSpecInput(
	draft: z.infer<typeof ByosanFeatureDraftSchema>,
	context: FeatureDraftContext,
): unknown {
	return {
		...draft,
		tags: ensureByosanBrandTag(draft.tags),
		schemaVersion: "byosan_feature_v1",
		runId: context.runId,
		asOf: context.asOf,
		angle: context.angle,
		searchQuery: context.searchQuery,
		production: context.production,
		narrative: context.narrative,
		adversarialEvidence: context.adversarialEvidence,
		activeProbes: context.activeProbes,
		sources: context.sources,
	};
}

export function featureDraftIssues(
	draft: Json,
	context: FeatureDraftContext,
): FeatureSpecIssue[] {
	const parsed = ByosanFeatureDraftSchema.safeParse(draft);
	if (!parsed.success) return zodIssues(parsed.error);
	const spec = ByosanFeatureSpecSchema.safeParse(
		buildFeatureSpecInput(parsed.data, context),
	);
	if (!spec.success) return zodIssues(spec.error);
	return [
		...auditByosanFeatureSpec(spec.data),
		...auditFeatureSpecAgainstExplanation(
			spec.data,
			context.explanation,
			context.numberEvidence,
		),
	];
}

export function isLocallyRepairable(path: string): boolean {
	return featureUnitSchema(path) !== undefined;
}

function parseIndexedUnit(
	unit: string,
): { key: string; index: number } | undefined {
	const match = INDEXED_UNIT.exec(unit);
	if (!match?.[1] || !match[2]) return undefined;
	return { key: match[1], index: Number(match[2]) };
}

export function featureUnitSchema(unit: string): z.ZodType | undefined {
	const indexed = parseIndexedUnit(unit);
	if (indexed) {
		const collection = DRAFT_SHAPE[indexed.key] as z.ZodArray<z.ZodType>;
		return collection.element;
	}
	if (COLLECTION_KEYS.includes(unit)) return undefined;
	return DRAFT_SHAPE[unit];
}

function featureUnitValue(draft: Json, unit: string): unknown {
	const indexed = parseIndexedUnit(unit);
	if (!indexed) return draft[unit];
	const items = draft[indexed.key];
	return Array.isArray(items) ? items[indexed.index] : undefined;
}

export function spliceFeatureUnit(
	draft: Json,
	unit: string,
	value: unknown,
): Json {
	const indexed = parseIndexedUnit(unit);
	if (!indexed) return { ...draft, [unit]: value };
	const { key, index } = indexed;
	const items = draft[key];
	if (!Array.isArray(items)) {
		throw new Error(`FEATURE_UNIT_COLLECTION_MISSING: ${unit}`);
	}
	const original = items[index];
	const next =
		key === "claims" &&
		isJson(value) &&
		isJson(original) &&
		typeof original.id === "string"
			? { ...value, id: original.id }
			: value;
	return {
		...draft,
		[key]: items.map((item, itemIndex) => (itemIndex === index ? next : item)),
	};
}

export function featureRepairMessages(input: {
	unit: string;
	issues: FeatureSpecIssue[];
	draft: Json;
	context: FeatureDraftContext;
	constraintLines: string;
	dialogueStyle: string;
}): Array<{ role: "system" | "user"; content: string }> {
	const { unit, issues, draft, context } = input;
	const indexed = parseIndexedUnit(unit);
	const segments = Array.isArray(draft.segments) ? draft.segments : [];
	const neighbors =
		indexed?.key === "segments"
			? {
					previous: segments[indexed.index - 1],
					next: segments[indexed.index + 1],
				}
			: undefined;
	return [
		{
			role: "system",
			content:
				'あなたは秒算マネーの台本の局所修復者です。指定された欄（unit）だけを、指摘（issues）を解消する形で直し、{"value": ...} の JSON で返します。他の欄は変更されません。evidence にない数字・断定・出典は作らず、evidence にある年・数・固有名は残します。推計・派生値の区別は claims の status で保ち、claims の id は変えません。台詞は dialogue_style に沿って自然に直します。',
		},
		{
			role: "user",
			content: JSON.stringify(
				{
					unit,
					current_value: featureUnitValue(draft, unit),
					issues: issues.map((issue) => ({
						code: issue.code,
						details: issue.details,
					})),
					evidence: {
						explanation: context.explanation,
						candidate_numbers: context.numberEvidence.numbers,
						source_text: context.numberEvidence.sourceText,
						claims: draft.claims,
						allowed_sources: context.sources,
						packaging: draft.packaging,
					},
					neighbors,
					constraints: input.constraintLines,
					dialogue_style: input.dialogueStyle,
				},
				null,
				2,
			),
		},
	];
}

export function summarizeFeatureIssues(issues: FeatureSpecIssue[]): string {
	return issues
		.map((issue) => `${issue.path || "(draft)"} ${issue.code}=${issue.details}`)
		.join("; ");
}

export async function repairFeatureDraftLocally(input: {
	draft: Json;
	sources: ByosanFeatureSource[];
	maxRepairs: number;
	check: (draft: Json) => FeatureSpecIssue[];
	repairUnit: (
		unit: string,
		issues: FeatureSpecIssue[],
		draft: Json,
	) => Promise<unknown>;
}): Promise<{
	draft: Json;
	corrections: FeatureCorrection[];
	rounds: FeatureRepairRound[];
}> {
	let current = input.draft;
	const corrections: FeatureCorrection[] = [];
	const rounds: FeatureRepairRound[] = [];
	for (let round = 0; ; round += 1) {
		const issues = input.check(current);
		if (issues.length === 0) return { draft: current, corrections, rounds };
		const global = issues.filter((issue) => !isLocallyRepairable(issue.path));
		if (global.length > 0) {
			throw new Error(
				`BYOSAN_FEATURE_DRAFT_NOT_LOCALLY_REPAIRABLE: ${summarizeFeatureIssues(global)}`,
			);
		}
		if (round >= input.maxRepairs) {
			throw new Error(
				`BYOSAN_FEATURE_LOCAL_REPAIR_EXHAUSTED: rounds=${round} ${summarizeFeatureIssues(issues)}`,
			);
		}
		const units = [...new Set(issues.map((issue) => issue.path))];
		let next = current;
		for (const unit of units) {
			const value = await input.repairUnit(
				unit,
				issues.filter((issue) => issue.path === unit),
				current,
			);
			next = spliceFeatureUnit(next, unit, value);
		}
		const normalized = normalizeFeatureDraft(next, input.sources);
		corrections.push(...normalized.corrections);
		rounds.push({
			round: round + 1,
			units,
			issueCodes: issues.map((issue) => issue.code),
		});
		current = normalized.draft;
	}
}
