import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";

const CONFIG_PATH = "config/domains/byosan_money.yaml";
const SEC_API_ORIGIN = "https://data.sec.gov";
const DAY_MS = 86_400_000;

const DayRangeSchema = z.object({
	min: z.number().int().positive(),
	max: z.number().int().positive(),
});

const SecConfigSchema = z.object({
	sec: z.object({
		user_agent: z.string().min(1),
		min_interval_ms: z.number().int().positive(),
		companies: z
			.array(
				z.object({
					name: z.string().min(1),
					cik: z.string().regex(/^\d{10}$/),
				}),
			)
			.min(1),
		period_days: z.object({
			annual: DayRangeSchema,
			quarter: DayRangeSchema,
		}),
		metrics: z
			.array(
				z.object({
					label: z.string().min(1),
					tags: z.array(z.string().min(1)).min(1),
				}),
			)
			.min(1),
	}),
});

export type SecConfig = z.infer<typeof SecConfigSchema>["sec"];

const CompanyConceptFactSchema = z.object({
	start: z.string().optional(),
	end: z.string(),
	val: z.number(),
	accn: z.string(),
	fy: z.number().int().nullable(),
	fp: z.string().nullable(),
	form: z.string(),
	filed: z.string(),
});

const CompanyConceptSchema = z.object({
	units: z.record(z.string(), z.array(CompanyConceptFactSchema)),
});

const CompanyFactsSchema = z.object({
	facts: z.object({
		"us-gaap": z.record(z.string(), CompanyConceptSchema).optional(),
	}),
});

export type SecFact = {
	fy: number | null;
	fp: string | null;
	form: string;
	filed: string;
	start?: string;
	end: string;
	val: number;
	unit: string;
	accn: string;
};

export type ConceptFact = SecFact & { tag: string };

export type Figure = { label: string; tag: string; fact: SecFact };

export type FactSelector = {
	period: { start?: string; end: string };
	form?: string;
	unit: string;
};

export type FigureClaim = {
	value: number;
	basis: "GAAP" | "NON_GAAP" | "UNSTATED";
	kind: "ACTUAL" | "FORECAST" | "UNSTATED";
	selector: FactSelector;
};

export type FigureVerdict =
	| { status: "MATCH" | "MISMATCH"; fact: SecFact; reason: string }
	| { status: "UNRESOLVED"; fact: null; reason: string };

export function loadSecConfig(): SecConfig {
	const raw = yaml.load(
		fs.readFileSync(path.join(process.cwd(), CONFIG_PATH), "utf8"),
	);
	return SecConfigSchema.parse(raw).sec;
}

function flattenConcept(
	concept: z.infer<typeof CompanyConceptSchema>,
): SecFact[] {
	return Object.entries(concept.units).flatMap(([unit, records]) =>
		records.map((record) => ({
			fy: record.fy,
			fp: record.fp,
			form: record.form,
			filed: record.filed,
			start: record.start,
			end: record.end,
			val: record.val,
			unit,
			accn: record.accn,
		})),
	);
}

export function parseCompanyConcept(json: unknown): SecFact[] {
	return flattenConcept(CompanyConceptSchema.parse(json));
}

export function parseCompanyFacts(json: unknown): ConceptFact[] {
	const parsed = CompanyFactsSchema.parse(json);
	return Object.entries(parsed.facts["us-gaap"] ?? {}).flatMap(
		([tag, concept]) =>
			flattenConcept(concept).map((fact) => ({ ...fact, tag })),
	);
}

let nextRequestAt = 0;

export async function fetchCompanyConcept({
	cik,
	taxonomy,
	tag,
}: {
	cik: string;
	taxonomy: string;
	tag: string;
}): Promise<SecFact[]> {
	const config = loadSecConfig();
	const slot = Math.max(Date.now(), nextRequestAt);
	nextRequestAt = slot + config.min_interval_ms;
	await Bun.sleep(Math.max(0, slot - Date.now()));
	const url = `${SEC_API_ORIGIN}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`;
	const res = await fetch(url, {
		headers: { "user-agent": config.user_agent, accept: "application/json" },
	});
	if (!res.ok) throw new Error(`SEC_FETCH_FAILED ${res.status} ${url}`);
	return parseCompanyConcept(await res.json());
}

export function findFact(
	facts: readonly SecFact[],
	selector: FactSelector,
): SecFact {
	const candidates = facts.filter(
		(fact) =>
			fact.unit === selector.unit &&
			fact.end === selector.period.end &&
			(selector.period.start === undefined ||
				fact.start === selector.period.start) &&
			(selector.form === undefined || fact.form === selector.form),
	);
	if (candidates.length === 0) {
		throw new Error(`SEC_FACT_NOT_FOUND ${JSON.stringify(selector)}`);
	}
	const values = new Set(candidates.map((fact) => fact.val));
	if (values.size > 1) {
		throw new Error(
			`SEC_FACT_AMBIGUOUS ${JSON.stringify(selector)} values=${[...values].join(",")}`,
		);
	}
	return candidates.reduce((original, fact) =>
		fact.filed < original.filed ? fact : original,
	);
}

function inPeriodRange(
	fact: SecFact,
	range: z.infer<typeof DayRangeSchema>,
): boolean {
	if (fact.start === undefined) return true;
	const days =
		(new Date(fact.end).getTime() - new Date(fact.start).getTime()) / DAY_MS;
	return days >= range.min && days <= range.max;
}

function figureFor(
	own: readonly ConceptFact[],
	metric: SecConfig["metrics"][number],
	range: z.infer<typeof DayRangeSchema>,
): Figure | undefined {
	for (const tag of metric.tags) {
		const candidates = own.filter((fact) => fact.tag === tag);
		if (candidates.length === 0) continue;
		const latest = candidates.reduce(
			(max, fact) => (fact.end > max ? fact.end : max),
			"",
		);
		const current = candidates.filter(
			(fact) => fact.end === latest && inPeriodRange(fact, range),
		);
		const selected = current[0];
		if (selected === undefined) return undefined;
		const fact = findFact(current, {
			period: { start: selected.start, end: selected.end },
			unit: selected.unit,
		});
		return { label: metric.label, tag, fact };
	}
	return undefined;
}

export function accessionFigures(
	facts: readonly ConceptFact[],
	accession: string,
	sec: Pick<SecConfig, "metrics" | "period_days">,
): Figure[] {
	const own = facts.filter((fact) => fact.accn === accession);
	if (own.length === 0) throw new Error(`XBRL_FACTS_NOT_FOUND ${accession}`);
	const range =
		own[0]?.fp === "FY" ? sec.period_days.annual : sec.period_days.quarter;
	const figures = sec.metrics.flatMap((metric) => {
		const figure = figureFor(own, metric, range);
		return figure === undefined ? [] : [figure];
	});
	if (figures.length === 0) {
		throw new Error(`XBRL_METRICS_NOT_FOUND ${accession}`);
	}
	return figures;
}

export function verifyFigure({
	facts,
	claim,
	tolerance,
}: {
	facts: readonly SecFact[];
	claim: FigureClaim;
	tolerance: number;
}): FigureVerdict {
	if (claim.basis !== "GAAP") {
		return {
			status: "UNRESOLVED",
			fact: null,
			reason: `claim basis is ${claim.basis}; XBRL companyconcept holds GAAP facts only`,
		};
	}
	if (claim.kind !== "ACTUAL") {
		return {
			status: "UNRESOLVED",
			fact: null,
			reason: `claim kind is ${claim.kind}; only reported actuals exist in XBRL facts`,
		};
	}
	const fact = findFact(facts, claim.selector);
	const difference = Math.abs(claim.value - fact.val);
	const allowed = tolerance * Math.abs(fact.val);
	return {
		status: difference <= allowed ? "MATCH" : "MISMATCH",
		fact,
		reason: `claimed ${claim.value} vs GAAP ${fact.val} (${fact.form} ${JSON.stringify({ start: fact.start, end: fact.end })}, accn ${fact.accn}); difference ${difference}, allowed ${allowed}`,
	};
}
