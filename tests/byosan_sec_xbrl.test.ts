import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	type FigureClaim,
	type SecFact,
	accessionFigures,
	findFact,
	loadSecConfig,
	parseCompanyConcept,
	parseCompanyFacts,
	verifyFigure,
} from "../src/domain/byosan/sec_xbrl.js";

const FIXTURE = "tests/fixtures/sec/nvda_revenues_companyconcept.json";
const COMPANYFACTS_FIXTURE =
	"tests/fixtures/sec/nvda_companyfacts_10q_subset.json";
const Q2_ACCESSION = "0001045810-26-000075";

function fixtureFacts(): SecFact[] {
	return parseCompanyConcept(JSON.parse(fs.readFileSync(FIXTURE, "utf8")));
}

const Q2_FY2027 = {
	period: { start: "2026-04-27", end: "2026-07-26" },
	form: "10-Q",
	unit: "USD",
};

const Q2_FY2026 = {
	period: { start: "2025-04-28", end: "2025-07-27" },
	form: "10-Q",
	unit: "USD",
};

describe("SEC XBRL companyconcept", () => {
	test("reads the User-Agent and CIK list from the byosan config", () => {
		const sec = loadSecConfig();
		expect(sec.user_agent).toBe("yt3-byosan research");
		expect(sec.min_interval_ms).toBeGreaterThan(100);
		expect(sec.companies.map((company) => company.cik)).toEqual([
			"0000723125",
			"0001045810",
			"0001046179",
		]);
	});

	test("flattens every unit record into typed facts", () => {
		const facts = fixtureFacts();
		expect(facts).toHaveLength(14);
		expect(facts).toContainEqual({
			fy: 2025,
			fp: "FY",
			form: "10-K",
			filed: "2025-02-26",
			start: "2024-01-29",
			end: "2025-01-26",
			val: 130497000000,
			unit: "USD",
			accn: "0001045810-25-000023",
		});
	});

	test("keeps proxy-statement facts whose fiscal year and period are null", () => {
		const facts = parseCompanyConcept({
			units: {
				USD: [
					{
						start: "2024-01-29",
						end: "2025-01-26",
						val: 72880000000,
						accn: "0001045810-26-000036",
						fy: null,
						fp: null,
						form: "DEF 14A",
						filed: "2026-05-12",
						frame: "CY2024",
					},
				],
			},
		});
		expect(facts).toEqual([
			{
				fy: null,
				fp: null,
				form: "DEF 14A",
				filed: "2026-05-12",
				start: "2024-01-29",
				end: "2025-01-26",
				val: 72880000000,
				unit: "USD",
				accn: "0001045810-26-000036",
			},
		]);
	});

	test("resolves a re-reported quarter to its original filing", () => {
		const fact = findFact(fixtureFacts(), Q2_FY2026);
		expect(fact.val).toBe(46743000000);
		expect(fact.accn).toBe("0001045810-25-000209");
		expect(fact.filed).toBe("2025-08-27");
	});

	test("throws when an end date alone matches a year-to-date and a quarterly fact", () => {
		expect(() =>
			findFact(fixtureFacts(), {
				period: { end: "2025-07-27" },
				form: "10-Q",
				unit: "USD",
			}),
		).toThrow("SEC_FACT_AMBIGUOUS");
	});

	test("throws when re-reports of the same period disagree on the value", () => {
		const conflicting: SecFact[] = [
			...fixtureFacts(),
			{
				fy: 2026,
				fp: "Q2",
				form: "10-Q",
				filed: "2026-01-15",
				start: "2025-04-28",
				end: "2025-07-27",
				val: 46000000000,
				unit: "USD",
				accn: "0001045810-26-000001",
			},
		];
		expect(() => findFact(conflicting, Q2_FY2026)).toThrow(
			"SEC_FACT_AMBIGUOUS",
		);
	});

	test("throws when no fact matches the selector", () => {
		expect(() =>
			findFact(fixtureFacts(), {
				period: { start: "2019-01-01", end: "2019-03-31" },
				form: "10-Q",
				unit: "USD",
			}),
		).toThrow("SEC_FACT_NOT_FOUND");
	});

	test("verifies an exact GAAP actual as MATCH", () => {
		const claim: FigureClaim = {
			value: 96221000000,
			basis: "GAAP",
			kind: "ACTUAL",
			selector: Q2_FY2027,
		};
		const verdict = verifyFigure({
			facts: fixtureFacts(),
			claim,
			tolerance: 0,
		});
		expect(verdict.status).toBe("MATCH");
		expect(verdict.fact?.accn).toBe("0001045810-26-000075");
	});

	test("verifies a figure outside tolerance as MISMATCH", () => {
		const verdict = verifyFigure({
			facts: fixtureFacts(),
			claim: {
				value: 96000000000,
				basis: "GAAP",
				kind: "ACTUAL",
				selector: Q2_FY2027,
			},
			tolerance: 0.001,
		});
		expect(verdict.status).toBe("MISMATCH");
	});

	test("accepts a rounded figure within relative tolerance as MATCH", () => {
		const verdict = verifyFigure({
			facts: fixtureFacts(),
			claim: {
				value: 96200000000,
				basis: "GAAP",
				kind: "ACTUAL",
				selector: Q2_FY2027,
			},
			tolerance: 0.001,
		});
		expect(verdict.status).toBe("MATCH");
	});

	test("returns UNRESOLVED for a non-GAAP claim", () => {
		const verdict = verifyFigure({
			facts: fixtureFacts(),
			claim: {
				value: 96221000000,
				basis: "NON_GAAP",
				kind: "ACTUAL",
				selector: Q2_FY2027,
			},
			tolerance: 0,
		});
		expect(verdict.status).toBe("UNRESOLVED");
		expect(verdict.fact).toBeNull();
	});

	test("returns UNRESOLVED for a forecast claim", () => {
		const verdict = verifyFigure({
			facts: fixtureFacts(),
			claim: {
				value: 96221000000,
				basis: "GAAP",
				kind: "FORECAST",
				selector: Q2_FY2027,
			},
			tolerance: 0,
		});
		expect(verdict.status).toBe("UNRESOLVED");
	});

	test("returns UNRESOLVED when the claim does not state its basis or kind", () => {
		const verdict = verifyFigure({
			facts: fixtureFacts(),
			claim: {
				value: 96221000000,
				basis: "UNSTATED",
				kind: "UNSTATED",
				selector: Q2_FY2027,
			},
			tolerance: 0,
		});
		expect(verdict.status).toBe("UNRESOLVED");
	});
});

describe("SEC XBRL companyfacts figures", () => {
	function companyFacts() {
		return parseCompanyFacts(
			JSON.parse(fs.readFileSync(COMPANYFACTS_FIXTURE, "utf8")),
		);
	}

	test("takes the quarter of a 10-Q and not the year-to-date value", () => {
		const revenue = accessionFigures(
			companyFacts(),
			Q2_ACCESSION,
			loadSecConfig(),
		).find((figure) => figure.label === "売上");
		expect(revenue?.fact).toMatchObject({
			val: 96221000000,
			start: "2026-04-27",
			end: "2026-07-26",
			unit: "USD",
			form: "10-Q",
		});
	});

	test("reports a balance sheet item at its instant date", () => {
		const cash = accessionFigures(
			companyFacts(),
			Q2_ACCESSION,
			loadSecConfig(),
		).find((figure) => figure.label === "現金及び現金同等物");
		expect(cash?.fact).toMatchObject({ val: 22443000000, end: "2026-07-26" });
		expect(cash?.fact.start).toBeUndefined();
	});

	test("omits a metric the filing does not tag", () => {
		const labels = accessionFigures(
			companyFacts(),
			Q2_ACCESSION,
			loadSecConfig(),
		).map((figure) => figure.label);
		expect(labels).not.toContain("設備投資（有形固定資産の取得支出）");
	});

	test("throws when no XBRL fact carries the accession", () => {
		expect(() =>
			accessionFigures(companyFacts(), "0001045810-26-999999", loadSecConfig()),
		).toThrow("XBRL_FACTS_NOT_FOUND");
	});

	test("reads no us-gaap facts from an IFRS filer", () => {
		expect(
			parseCompanyFacts({ facts: { "ifrs-full": { Revenue: {} } } }),
		).toEqual([]);
	});
});
