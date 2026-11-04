import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import * as yaml from "js-yaml";
import { z } from "zod";
import { DraftArticlesSchema } from "./feature_draft.js";
import { normalizedSourceUrl } from "./published_sources.js";

export const FACT_SHEET_SCHEMA_VERSION = "byosan_fact_sheet_v1";

type DraftArticles = z.infer<typeof DraftArticlesSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SourceDocumentSchema = z
	.object({
		url: z.string().min(1),
		title: z.string().min(1),
		issuer: z.string().min(1),
		published: z.string().regex(ISO_DATE),
	})
	.strict();

const FactSchema = z
	.object({
		id: z.string().regex(/^[a-z][a-z0-9_]*$/),
		label: z.string().min(1),
		value: z.number(),
		unit: z.string().min(1),
		period: z.string().min(1),
		basis: z.enum(["actual", "forecast"]),
		source_url: z.string().min(1).optional(),
		status: z.string().min(1),
		note: z.string().min(1).optional(),
	})
	.strict();

const UnverifiedItemSchema = z
	.object({
		id: z.string().regex(/^[a-z][a-z0-9_]*$/),
		label: z.string().min(1),
		text: z.string().min(1),
		source_url: z.string().min(1).optional(),
		status: z.string().min(1),
		note: z.string().min(1).optional(),
	})
	.strict();

const FactSheetSchema = z
	.object({
		schema_version: z.literal(FACT_SHEET_SCHEMA_VERSION),
		company: z.string().min(1),
		subject: z.string().min(1).optional(),
		released: z.string().regex(ISO_DATE),
		source_documents: z.array(SourceDocumentSchema).min(1),
		facts: z.array(FactSchema).min(1),
		unverified: z.array(UnverifiedItemSchema).default([]),
	})
	.strict();

export type FactSheet = z.infer<typeof FactSheetSchema>;
export type FactSheetFact = FactSheet["facts"][number];
type SourceDocument = FactSheet["source_documents"][number];

export type LoadedFactSheet = {
	sheet: FactSheet;
	sha256: string;
};

const isHttpUrl = (value: string): boolean => {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
};

// Refuses the whole sheet when any fact is unsourced or not CONFIRMED.
// Gaps are reported, never filled.
export function parseFactSheet(raw: unknown): FactSheet {
	const parsed = FactSheetSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`FACT_SHEET_INVALID: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
				.join("; ")}`,
		);
	}
	const sheet = parsed.data;
	const problems: string[] = [];
	const documentUrls = new Set<string>();
	for (const doc of sheet.source_documents) {
		if (!isHttpUrl(doc.url)) {
			problems.push(`source_documents ${doc.url}: not an http(s) URL`);
		}
		if (documentUrls.has(doc.url)) {
			problems.push(`source_documents ${doc.url}: duplicated`);
		}
		documentUrls.add(doc.url);
	}
	const factIds = new Set<string>();
	for (const fact of sheet.facts) {
		if (factIds.has(fact.id)) problems.push(`${fact.id}: duplicate fact id`);
		factIds.add(fact.id);
		if (fact.source_url === undefined) {
			problems.push(`${fact.id}: source_url is missing`);
		} else if (!isHttpUrl(fact.source_url)) {
			problems.push(`${fact.id}: source_url is not an http(s) URL`);
		} else if (!documentUrls.has(fact.source_url)) {
			problems.push(
				`${fact.id}: source_url has no entry in source_documents (${fact.source_url})`,
			);
		}
		if (fact.status !== "CONFIRMED") {
			problems.push(
				`${fact.id}: status=${fact.status} (only CONFIRMED is accepted)`,
			);
		}
	}
	for (const item of sheet.unverified) {
		if (factIds.has(item.id)) problems.push(`${item.id}: duplicate id`);
		factIds.add(item.id);
		if (item.status !== "UNVERIFIED") {
			problems.push(
				`unverified ${item.id}: status=${item.status} (must be UNVERIFIED; move it to facts only when CONFIRMED with a source)`,
			);
		}
	}
	if (problems.length > 0) {
		throw new Error(`FACT_SHEET_REFUSED: ${problems.join(" | ")}`);
	}
	return sheet;
}

export function loadFactSheet(file: string): LoadedFactSheet {
	if (!fs.existsSync(file)) throw new Error(`FACT_SHEET_NOT_FOUND: ${file}`);
	const text = fs.readFileSync(file, "utf8");
	const ext = path.extname(file).toLowerCase();
	const raw =
		ext === ".json"
			? JSON.parse(text)
			: ext === ".yaml" || ext === ".yml"
				? yaml.load(text)
				: undefined;
	if (raw === undefined) {
		throw new Error(
			`FACT_SHEET_INVALID: expected .json, .yaml or .yml: ${file}`,
		);
	}
	return {
		sheet: parseFactSheet(raw),
		sha256: createHash("sha256").update(text).digest("hex"),
	};
}

// Unset or blank means the daily discovery path, unchanged.
export function factSheetPathFromEnv(env: NodeJS.ProcessEnv): string | null {
	const raw = env.BYOSAN_FACT_SHEET?.trim();
	return raw ? path.resolve(raw) : null;
}

// A fact-sheet run must not share a run directory with the daily run of the
// same date, so it needs its own BYOSAN_SUFFIX.
export function assertFactSheetRunSuffix(suffix: string | undefined): void {
	if (!/^-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(suffix ?? "")) {
		throw new Error(
			"FACT_SHEET_RUN_SUFFIX_REQUIRED: set BYOSAN_SUFFIX to -<name> (for example -sbi-h1) so the run has its own directory",
		);
	}
}

export function assertFactSheetUnpublished(
	sheet: FactSheet,
	publishedUrls: ReadonlySet<string>,
): void {
	for (const doc of sheet.source_documents) {
		const key = normalizedSourceUrl(doc.url);
		if (key !== null && publishedUrls.has(key)) {
			throw new Error(`FACT_SHEET_SOURCE_ALREADY_PUBLISHED: ${doc.url}`);
		}
	}
}

export function factSheetHosts(sheet: FactSheet): string[] {
	return sheet.source_documents.map((doc) => new URL(doc.url).hostname);
}

const BASIS_LABEL: Record<FactSheetFact["basis"], string> = {
	actual: "実績",
	forecast: "予想",
};

const formatValue = (value: number): string =>
	Number.isInteger(value) ? value.toLocaleString("en-US") : String(value);

const renderFact = (fact: FactSheetFact): string =>
	`- ${fact.label}: ${formatValue(fact.value)}${fact.unit}（${fact.period}・${BASIS_LABEL[fact.basis]}）${fact.note ? ` 注記: ${fact.note}` : ""}`;

// One article per cited source URL. Its body is only the verified facts that
// cite it, so every figure the script may use is one of those facts.
export function factSheetArticles(sheet: FactSheet): DraftArticles {
	const byUrl = new Map<string, FactSheetFact[]>();
	for (const fact of sheet.facts) {
		const url = fact.source_url as string;
		byUrl.set(url, [...(byUrl.get(url) ?? []), fact]);
	}
	const docs = new Map<string, SourceDocument>(
		sheet.source_documents.map((doc) => [doc.url, doc]),
	);
	return DraftArticlesSchema.parse(
		[...byUrl.entries()].map(([url, facts]) => {
			const doc = docs.get(url) as SourceDocument;
			return {
				title: doc.title,
				url,
				issuer: doc.issuer,
				published: doc.published,
				body: [
					`${sheet.company} 公表日 ${sheet.released}`,
					...facts.map(renderFact),
				].join("\n"),
			};
		}),
	);
}

export function writeFactSheetResearch(
	loaded: LoadedFactSheet,
	runDir: string,
): void {
	const recordPath = path.join(runDir, "research", "fact_sheet.json");
	if (
		!fs.existsSync(recordPath) &&
		fs.existsSync(path.join(runDir, "research", "discovery_articles.json"))
	) {
		throw new Error(
			"FACT_SHEET_RUN_COLLISION: this run directory already holds discovery research; use a new BYOSAN_SUFFIX",
		);
	}
	if (fs.existsSync(recordPath)) {
		const prior = fs.readJsonSync(recordPath) as { sha256?: string };
		if (prior.sha256 !== loaded.sha256) {
			throw new Error(
				"FACT_SHEET_CHANGED: this run directory was built from a different fact sheet; use a new BYOSAN_SUFFIX",
			);
		}
	}
	fs.outputJsonSync(
		recordPath,
		{ sha256: loaded.sha256, sheet: loaded.sheet },
		{ spaces: 2 },
	);
	fs.outputJsonSync(
		path.join(runDir, "research", "discovery_articles.json"),
		factSheetArticles(loaded.sheet),
		{ spaces: 2 },
	);
}
