import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type DiscoveryConfig,
	writeDiscoveryEvidence,
} from "../src/domain/byosan/feed_discovery.js";
import { loadConfig } from "../src/io/core.js";

const NOW = new Date("2026-10-25T00:00:00Z");
const CONFIG = (
	loadConfig("byosan_money") as unknown as { discovery: DiscoveryConfig }
).discovery;

const LONG_1 =
	"About a quarter of the way through the third quarter earnings season, the S&P 500 is reporting mixed results relative to expectations.";
const LONG_2 =
	"Analysts have increased the aggregate third quarter EPS estimate for the index since the end of the quarter, which is unusual at this stage.";
const ARTICLE_URL =
	"https://insight.factset.com/sp-500-earnings-season-update-october-23-2026";
const MISMATCH_URL = "https://insight.factset.com/mismatched-article";
const PUB_DATE = "Fri, 23 Oct 2026 12:00:00 GMT";
const MICRON_DIR = "https://www.sec.gov/Archives/edgar/data/723125";
const ACCEPTED = "000072312526000100";
const MISSING_EXHIBIT = "000072312526000101";

function rssItem(title: string, link: string): string {
	return `<item><title>${title}</title><link>${link}</link><pubDate>${PUB_DATE}</pubDate><description>summary</description></item>`;
}

function articlePage(title: string, paragraphs: string[]): string {
	return `<html><head><meta property="og:title" content="${title}"></head><body><p>Home</p>${paragraphs.map((p) => `<p>${p}</p>`).join("")}<p>Share</p></body></html>`;
}

function submissions(
	name: string,
	rows: { form: string; accession: string; doc: string; items: string }[],
): string {
	return JSON.stringify({
		name,
		filings: {
			recent: {
				form: rows.map((r) => r.form),
				filingDate: rows.map(() => "2026-10-22"),
				accessionNumber: rows.map((r) => r.accession),
				primaryDocument: rows.map((r) => r.doc),
				items: rows.map((r) => r.items),
			},
		},
	});
}

const ROUTES: Record<string, string> = {
	"https://insight.factset.com/topic/earnings/rss.xml": `<rss><channel>${rssItem("S&amp;P 500 Earnings Season Update: October 23, 2026", ARTICLE_URL)}${rssItem("Mismatched Title", MISMATCH_URL)}</channel></rss>`,
	[ARTICLE_URL]: articlePage(
		"S&amp;P 500 Earnings Season Update: October 23, 2026",
		[LONG_1, LONG_2],
	),
	[MISMATCH_URL]: articlePage("FactSet Insight - Commentary", [LONG_1]),
	"https://data.sec.gov/submissions/CIK0000723125.json": submissions(
		"MICRON TECHNOLOGY, INC.",
		[
			{
				form: "8-K",
				accession: "0000723125-26-000100",
				doc: "mu-20261022.htm",
				items: "2.02,9.01",
			},
			{
				form: "8-K",
				accession: "0000723125-26-000101",
				doc: "mu-20261022b.htm",
				items: "2.02,9.01",
			},
		],
	),
	"https://data.sec.gov/submissions/CIK0001045810.json": submissions(
		"NVIDIA CORP",
		[],
	),
	"https://data.sec.gov/submissions/CIK0001046179.json": submissions(
		"TAIWAN SEMICONDUCTOR",
		[],
	),
	[`${MICRON_DIR}/${ACCEPTED}/0000723125-26-000100-index.htm`]: `<table><tr><td>1</td><td><a href="/Archives/edgar/data/723125/${ACCEPTED}/mu-20261022.htm">mu-20261022.htm</a></td><td>8-K</td></tr><tr><td>2</td><td><a href="/Archives/edgar/data/723125/${ACCEPTED}/ex99-1.htm">ex99-1.htm</a></td><td>EX-99.1</td></tr></table>`,
	[`${MICRON_DIR}/${ACCEPTED}/mu-20261022.htm`]:
		"<html><body><p>Cover page of the current report.</p></body></html>",
	[`${MICRON_DIR}/${ACCEPTED}/ex99-1.htm`]:
		"<html><body><p>Micron reports revenue of $12.3 billion for the quarter.</p></body></html>",
	[`${MICRON_DIR}/${MISSING_EXHIBIT}/0000723125-26-000101-index.htm`]: `<table><tr><td>1</td><td><a href="/Archives/edgar/data/723125/${MISSING_EXHIBIT}/mu-20261022b.htm">mu-20261022b.htm</a></td><td>8-K</td></tr></table>`,
	[`${MICRON_DIR}/${MISSING_EXHIBIT}/mu-20261022b.htm`]:
		"<html><body><p>Cover page without the press release.</p></body></html>",
};

type Article = { feed: string; title: string; url: string; body: string };
type Exclusion = { feed: string; url: string; reason: string };

async function discover(): Promise<{
	articles: Article[];
	excluded: Exclusion[];
}> {
	const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-feed-discovery-"));
	await writeDiscoveryEvidence(CONFIG, runDir, NOW);
	return {
		articles: fs.readJsonSync(
			path.join(runDir, "research", "discovery_articles.json"),
		),
		excluded: fs.readJsonSync(
			path.join(runDir, "research", "discovery_excluded.json"),
		),
	};
}

describe("byosan feed discovery bodies", () => {
	beforeEach(() => {
		const routed = async (input: string | Request | URL) =>
			new Response(ROUTES[String(input)] ?? "", { status: 200 });
		spyOn(globalThis, "fetch").mockImplementation(routed as typeof fetch);
	});

	afterEach(() => {
		mock.restore();
	});

	test("takes the article paragraphs as the body and excludes a page whose title does not match", async () => {
		const { articles, excluded } = await discover();
		expect(articles.find((a) => a.url === ARTICLE_URL)?.body).toBe(
			`${LONG_1}\n${LONG_2}`,
		);
		expect(excluded).toContainEqual({
			feed: "S001",
			url: MISMATCH_URL,
			reason: `Error: TITLE_MISMATCH ${MISMATCH_URL}`,
		});
	});

	test("takes the press release exhibit into the filing body and excludes a filing without it", async () => {
		const { articles, excluded } = await discover();
		const micron = articles.find(
			(a) => a.url === `${MICRON_DIR}/${ACCEPTED}/mu-20261022.htm`,
		);
		expect(micron?.body).toContain("revenue of $12.3 billion");
		expect(excluded).toContainEqual({
			feed: "S008",
			url: `${MICRON_DIR}/${MISSING_EXHIBIT}/mu-20261022b.htm`,
			reason: `Error: EXHIBIT_NOT_FOUND EX-99.1 ${MICRON_DIR}/${MISSING_EXHIBIT}/mu-20261022b.htm`,
		});
	});
});
