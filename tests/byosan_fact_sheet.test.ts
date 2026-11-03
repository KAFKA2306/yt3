import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	assertFactSheetRunSuffix,
	assertFactSheetUnpublished,
	type FactSheet,
	factSheetArticles,
	factSheetHosts,
	factSheetPathFromEnv,
	loadFactSheet,
	parseFactSheet,
	writeFactSheetResearch,
} from "../src/domain/byosan/fact_sheet.js";
import { normalizedSourceUrl } from "../src/domain/byosan/published_sources.js";

const FIXTURE = path.join(
	import.meta.dir,
	"..",
	"config",
	"byosan",
	"fact_sheets",
	"sbi_holdings_2027_h1.json",
);

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

async function makeRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "byosan-fact-sheet-"));
	tempRoots.push(root);
	return root;
}

type RawSheet = Record<string, unknown> & {
	schema_version?: unknown;
	facts: Record<string, unknown>[];
	unverified: Record<string, unknown>[];
};

const fixtureRaw = (): RawSheet =>
	JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as RawSheet;

const factById = (raw: RawSheet, id: string): Record<string, unknown> => {
	const fact = raw.facts.find((f) => f.id === id);
	if (fact === undefined) throw new Error(`fixture has no fact ${id}`);
	return fact;
};

const withFact = (id: string, patch: Record<string, unknown>): RawSheet => {
	const raw = fixtureRaw();
	Object.assign(factById(raw, id), patch);
	return raw;
};

const withoutKey = (id: string, key: string): RawSheet => {
	const raw = fixtureRaw();
	delete factById(raw, id)[key];
	return raw;
};

describe("fact sheet input: validation refuses unsourced or non-CONFIRMED facts", () => {
	test("the example fixture is accepted and every fact is CONFIRMED with a source", () => {
		const { sheet } = loadFactSheet(FIXTURE);
		expect(sheet.facts.length).toBeGreaterThan(0);
		for (const fact of sheet.facts) {
			expect(fact.status).toBe("CONFIRMED");
			expect(fact.source_url).toMatch(/^https:\/\//);
		}
	});

	test("refuses a fact with no source_url and names the fact", () => {
		expect(() =>
			parseFactSheet(withoutKey("revenue_h1", "source_url")),
		).toThrow(/revenue_h1: source_url is missing/);
	});

	test("refuses a fact whose status is not CONFIRMED", () => {
		expect(() =>
			parseFactSheet(withFact("dividend_interim", { status: "UNVERIFIED" })),
		).toThrow(
			/dividend_interim: status=UNVERIFIED \(only CONFIRMED is accepted\)/,
		);
	});

	test("refuses a fact whose source_url is not listed in source_documents", () => {
		expect(() =>
			parseFactSheet(
				withFact("pretax_h1", {
					source_url: "https://example.com/not-listed.pdf",
				}),
			),
		).toThrow(/pretax_h1: source_url has no entry in source_documents/);
	});

	test("refuses a fact whose source_url is not an http(s) URL", () => {
		expect(() =>
			parseFactSheet(withFact("pretax_h1", { source_url: "not a url" })),
		).toThrow(
			/pretax_h1: source_url is not an http\(s\) URL|source_url has no entry/,
		);
	});

	test("refuses an unknown basis and a misspelled key (strict schema)", () => {
		expect(() =>
			parseFactSheet(withFact("pretax_h1", { basis: "estimate" })),
		).toThrow(/FACT_SHEET_INVALID/);
		const typo = fixtureRaw();
		factById(typo, "revenue_h1").source_ur = factById(
			typo,
			"revenue_h1",
		).source_url;
		delete factById(typo, "revenue_h1").source_url;
		expect(() => parseFactSheet(typo)).toThrow(/FACT_SHEET_INVALID/);
	});

	test("refuses a sheet without the schema version", () => {
		const raw = fixtureRaw();
		delete raw.schema_version;
		expect(() => parseFactSheet(raw)).toThrow(/FACT_SHEET_INVALID/);
	});

	test("refuses an unverified item that is recorded as CONFIRMED", () => {
		const raw = fixtureRaw();
		raw.unverified.forEach((item) => {
			item.status = "CONFIRMED";
		});
		expect(() => parseFactSheet(raw)).toThrow(
			/unverified full_year_forecast_not_disclosed: status=CONFIRMED/,
		);
	});

	test("reports every gap together instead of stopping at the first", () => {
		const raw = withoutKey("revenue_h1", "source_url");
		factById(raw, "pretax_h1").status = "CANDIDATE";
		let message = "";
		try {
			parseFactSheet(raw);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain("revenue_h1: source_url is missing");
		expect(message).toContain("pretax_h1: status=CANDIDATE");
	});

	test("a missing file is refused explicitly", () => {
		expect(() =>
			loadFactSheet(path.join(os.tmpdir(), "no-such-sheet.json")),
		).toThrow(/FACT_SHEET_NOT_FOUND/);
	});
});

describe("fact sheet input: the unset path is unchanged", () => {
	test("unset or blank FACT_SHEET selects the discovery path", () => {
		expect(factSheetPathFromEnv({})).toBeNull();
		expect(factSheetPathFromEnv({ BYOSAN_FACT_SHEET: "" })).toBeNull();
		expect(factSheetPathFromEnv({ BYOSAN_FACT_SHEET: "   " })).toBeNull();
	});

	test("a set FACT_SHEET resolves to an absolute path", () => {
		const resolved = factSheetPathFromEnv({
			BYOSAN_FACT_SHEET: "config/byosan/fact_sheets/sbi_holdings_2027_h1.json",
		});
		expect(resolved).not.toBeNull();
		expect(path.isAbsolute(resolved as string)).toBe(true);
	});

	test("a fact-sheet run needs its own BYOSAN_SUFFIX", () => {
		expect(() => assertFactSheetRunSuffix(undefined)).toThrow(
			/FACT_SHEET_RUN_SUFFIX_REQUIRED/,
		);
		expect(() => assertFactSheetRunSuffix("")).toThrow(
			/FACT_SHEET_RUN_SUFFIX_REQUIRED/,
		);
		expect(() => assertFactSheetRunSuffix("sbi-h1")).toThrow(
			/FACT_SHEET_RUN_SUFFIX_REQUIRED/,
		);
		expect(() => assertFactSheetRunSuffix("-sbi-h1")).not.toThrow();
	});
});

describe("fact sheet input: source material and checks", () => {
	test("one article per cited URL, each body holding exactly its facts", () => {
		const { sheet } = loadFactSheet(FIXTURE);
		const articles = factSheetArticles(sheet);
		expect(articles.map((a) => a.url).sort()).toEqual(
			[...new Set(sheet.facts.map((f) => f.source_url ?? ""))].sort(),
		);
		const bodyLines = articles.flatMap((a) =>
			a.body.split("\n").filter((line) => line.startsWith("- ")),
		);
		expect(bodyLines.length).toBe(sheet.facts.length);
	});

	test("bodies carry the verified values with their unit, period and basis", () => {
		const { sheet } = loadFactSheet(FIXTURE);
		const body = factSheetArticles(sheet)
			.map((a) => a.body)
			.join("\n");
		expect(body).toContain("連結収益: 1,057,515百万円（2026年4月〜9月・実績）");
		expect(body).toContain("連結税引前利益: 324,306百万円");
		expect(body).toContain("暗号資産事業の税引前損益: -1,595百万円");
		expect(body).toContain("期末配当予想: 80円（2027年3月期 期末・予想）");
		expect(body).toContain("銀行業");
	});

	test("the unverified full-year forecast wording never reaches the script input", () => {
		const { sheet } = loadFactSheet(FIXTURE);
		const body = factSheetArticles(sheet)
			.map((a) => a.body)
			.join("\n");
		expect(body).not.toContain("業績予想の開示は行っておりません");
	});

	test("the sheet's source hosts are the only extra hosts for the canonical audit", () => {
		const { sheet } = loadFactSheet(FIXTURE);
		expect(factSheetHosts(sheet)).toEqual([
			"www.sbigroup.co.jp",
			"www.sbigroup.co.jp",
		]);
	});

	test("refuses a sheet whose source was already published", () => {
		const { sheet } = loadFactSheet(FIXTURE);
		const published = new Set<string>([
			normalizedSourceUrl(sheet.source_documents[0]?.url ?? "") as string,
		]);
		expect(() => assertFactSheetUnpublished(sheet, published)).toThrow(
			/FACT_SHEET_SOURCE_ALREADY_PUBLISHED/,
		);
		expect(() => assertFactSheetUnpublished(sheet, new Set())).not.toThrow();
	});

	test("the research record refuses to be reused with a different sheet", async () => {
		const runDir = path.join(await makeRoot(), "run");
		const { sheet } = loadFactSheet(FIXTURE);
		writeFactSheetResearch({ sheet, sha256: "aaa" }, runDir);
		expect(
			fs.existsSync(path.join(runDir, "research", "discovery_articles.json")),
		).toBe(true);
		writeFactSheetResearch({ sheet, sha256: "aaa" }, runDir);
		expect(() =>
			writeFactSheetResearch({ sheet, sha256: "bbb" }, runDir),
		).toThrow(/FACT_SHEET_CHANGED/);
	});

	test("a run directory that already holds discovery research is never reused", async () => {
		const runDir = path.join(await makeRoot(), "run");
		fs.outputJsonSync(
			path.join(runDir, "research", "discovery_articles.json"),
			[],
		);
		const { sheet } = loadFactSheet(FIXTURE);
		expect(() =>
			writeFactSheetResearch({ sheet, sha256: "aaa" }, runDir),
		).toThrow(/FACT_SHEET_RUN_COLLISION/);
	});

	test("the sheet type exported for callers matches the fixture shape", () => {
		const typed: FactSheet = parseFactSheet(fixtureRaw());
		expect(typed.company).toContain("SBI");
	});
});
