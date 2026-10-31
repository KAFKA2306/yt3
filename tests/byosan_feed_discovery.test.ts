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
	loadDiscoveryBaseline,
	writeDiscoveryEvidence,
} from "../src/domain/byosan/feed_discovery.js";
import { loadConfig, ROOT } from "../src/io/core.js";

const NOW = new Date("2026-10-25T00:00:00Z");
const CONFIG = (
	loadConfig("byosan_money") as unknown as { discovery: DiscoveryConfig }
).discovery;
const SEC_FIXTURE = "tests/fixtures/sec/nvda_companyfacts_10q_subset.json";

const LONG_1 =
	"About a quarter of the way through the third quarter earnings season, the S&P 500 is reporting mixed results relative to expectations.";
const LONG_2 =
	"Analysts have increased the aggregate third quarter EPS estimate for the index since the end of the quarter, which is unusual at this stage.";
const ARTICLE_URL =
	"https://insight.factset.com/sp-500-earnings-season-update-october-23-2026";
const MISMATCH_URL = "https://insight.factset.com/mismatched-article";
const TOPIC_NEW_URL = "https://insight.factset.com/topic-new-article";
const TOPIC_OLD_URL = "https://insight.factset.com/topic-old-article";
const SITEMAP_NEW_URL = "https://insight.factset.com/sitemap-new-article";
const SITEMAP_OLD_URL = "https://insight.factset.com/sitemap-old-article";
const TOPIC_URL = "https://insight.factset.com/topic/earnings";
const PUB_DATE = "Fri, 23 Oct 2026 12:00:00 GMT";
const MICRON_8K = "0000723125-26-000100";
const NVDA_10Q = "0001045810-26-000075";
const TSMC_6K = "0001046179-26-000728";
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-feed-discovery-"));
const REGISTRY = path.relative(ROOT, path.join(TEST_DIR, "registry.json"));
const BASELINE = path.relative(ROOT, path.join(TEST_DIR, "baseline.json"));

function rssItem(title: string, link: string): string {
	return `<item><title>${title}</title><link>${link}</link><pubDate>${PUB_DATE}</pubDate><description>summary</description></item>`;
}

function articlePage(title: string, paragraphs: string[]): string {
	return `<html><head><meta property="og:title" content="${title}"></head><body><p>Home</p>${paragraphs.map((p) => `<p>${p}</p>`).join("")}<p>Share</p></body></html>`;
}

function topicListing(items: { url: string; date: string }[]): string {
	return items
		.map(
			(item) =>
				`<div class="fs--blog--item"><a class="fs--blog--item--upper" href="${item.url}" style="x"></a><div class="fs--blog--item--lower"><h6>${item.date}</h6><p><a href="${item.url}">title</a></p></div></div>`,
		)
		.join("");
}

function sitemap(entries: { url: string; lastmod: string }[]): string {
	return `<urlset>${entries
		.map(
			(e) =>
				`<url><loc>${e.url}</loc><image:image><image:loc>https://insight.factset.com/image.png</image:loc></image:image><lastmod>${e.lastmod}</lastmod></url>`,
		)
		.join("")}</urlset>`;
}

function submissions(
	name: string,
	rows: { form: string; accession: string; doc: string }[],
): string {
	return JSON.stringify({
		name,
		filings: {
			recent: {
				form: rows.map((r) => r.form),
				filingDate: rows.map(() => "2026-10-22"),
				accessionNumber: rows.map((r) => r.accession),
				primaryDocument: rows.map((r) => r.doc),
				items: rows.map(() => ""),
			},
		},
	});
}

const LONG_ARTICLE = articlePage(
	"S&amp;P 500 Earnings Season Update: October 23, 2026",
	[LONG_1, LONG_2],
);

const ROUTES: Record<string, string> = {
	"https://insight.factset.com/topic/earnings/rss.xml": `<rss><channel>${rssItem("S&amp;P 500 Earnings Season Update: October 23, 2026", ARTICLE_URL)}${rssItem("Mismatched Title", MISMATCH_URL)}</channel></rss>`,
	[ARTICLE_URL]: LONG_ARTICLE,
	[MISMATCH_URL]: articlePage("FactSet Insight - Commentary", [LONG_1]),
	[TOPIC_URL]: topicListing([
		{ url: ARTICLE_URL, date: "October 23, 2026" },
		{ url: TOPIC_NEW_URL, date: "October 20, 2026" },
	]),
	[`${TOPIC_URL}/page/2`]: topicListing([
		{ url: TOPIC_OLD_URL, date: "August 28, 2026" },
	]),
	[TOPIC_NEW_URL]: articlePage("Topic New Article", [LONG_1, LONG_2]),
	"https://insight.factset.com/sitemap.xml": sitemap([
		{ url: ARTICLE_URL, lastmod: "2026-10-23" },
		{ url: SITEMAP_NEW_URL, lastmod: "2026-10-21" },
		{ url: SITEMAP_OLD_URL, lastmod: "2026-08-01" },
	]),
	[SITEMAP_NEW_URL]: articlePage("Sitemap New Article", [LONG_1, LONG_2]),
	"https://data.sec.gov/submissions/CIK0000723125.json": submissions(
		"MICRON TECHNOLOGY, INC.",
		[{ form: "8-K", accession: MICRON_8K, doc: "mu-20261022.htm" }],
	),
	"https://data.sec.gov/submissions/CIK0001045810.json": submissions(
		"NVIDIA CORP",
		[{ form: "10-Q", accession: NVDA_10Q, doc: "nvda-20260726.htm" }],
	),
	"https://data.sec.gov/submissions/CIK0001046179.json": submissions(
		"TAIWAN SEMICONDUCTOR",
		[{ form: "6-K", accession: TSMC_6K, doc: "tsm-monthend6k.htm" }],
	),
	"https://data.sec.gov/api/xbrl/companyfacts/CIK0000723125.json":
		'{"facts":{"us-gaap":{}}}',
	"https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json":
		fs.readFileSync(SEC_FIXTURE, "utf8"),
	"https://data.sec.gov/api/xbrl/companyfacts/CIK0001046179.json":
		'{"facts":{"ifrs-full":{}}}',
};

const REGISTRY_SOURCES = [
	{
		id: "S001",
		issuer: "FactSet Earnings",
		domain: "insight.factset.com",
		url: "https://insight.factset.com/topic/earnings",
		category: "決算・業績予想",
		cadence: "日次",
		material_class: "独自集計/分析",
		collect: "S&P 500 EPS",
		caution: "対象期・実績比率を記録",
		verification: "公開記事確認",
		reuse_policy: "recreate_only",
		priority: "A",
		status: "採用",
		fetch: {
			type: "rss",
			url: "https://insight.factset.com/topic/earnings/rss.xml",
			body: "paragraphs",
		},
	},
	{
		id: "S002",
		issuer: "FactSet Insight",
		domain: "insight.factset.com",
		url: "https://insight.factset.com/",
		category: "投資研究",
		cadence: "日次",
		material_class: "独自分析",
		collect: "PER",
		caution: "予想と実績を区別",
		verification: "公開記事確認",
		reuse_policy: "recreate_only",
		priority: "A",
		status: "採用",
		fetch: {
			type: "rss",
			url: "https://insight.factset.com/rss.xml",
			body: "paragraphs",
		},
	},
	{
		id: "S008",
		issuer: "Micron IR",
		domain: "investors.micron.com",
		url: "https://investors.micron.com/",
		category: "企業財務",
		cadence: "決算時",
		material_class: "企業一次開示",
		collect: "売上",
		caution: "GAAP/Non-GAAPの区別",
		verification: "企業公式",
		reuse_policy: "recreate_only",
		priority: "A",
		status: "採用",
		fetch: { type: "sec", cik: "0000723125", forms: ["10-K", "10-Q", "8-K"] },
	},
	{
		id: "S009",
		issuer: "NVIDIA IR",
		domain: "investor.nvidia.com",
		url: "https://investor.nvidia.com/",
		category: "企業財務",
		cadence: "決算時",
		material_class: "企業一次開示",
		collect: "売上",
		caution: "受注見込と確定売上の区別",
		verification: "企業公式",
		reuse_policy: "recreate_only",
		priority: "A",
		status: "採用",
		fetch: { type: "sec", cik: "0001045810", forms: ["10-K", "10-Q", "8-K"] },
	},
	{
		id: "S010",
		issuer: "TSMC IR",
		domain: "investor.tsmc.com",
		url: "https://investor.tsmc.com/english",
		category: "企業財務",
		cadence: "月次・決算時",
		material_class: "企業一次開示",
		collect: "売上",
		caution: "月次と四半期を分離",
		verification: "企業公式",
		reuse_policy: "recreate_only",
		priority: "A",
		status: "採用",
		fetch: { type: "sec", cik: "0001046179", forms: ["6-K", "20-F"] },
	},
];

type BaselineSource = DiscoveryConfig["baseline"]["sources"][number];
type HtmlItemsFetch = Extract<BaselineSource["fetch"], { type: "html_items" }>;

const TOPIC_FETCH: HtmlItemsFetch = {
	type: "html_items",
	url: TOPIC_URL,
	page_url: `${TOPIC_URL}/page/{n}`,
	pages: 5,
	item: '<div class="fs--blog--item">\\s*<a class="fs--blog--item--upper" href="(?<url>[^"]+)"[\\s\\S]*?<h6[^>]*>\\s*(?<date>[^<]+?)\\s*</h6>',
	link: "^https://insight\\.factset\\.com/[^/]+$",
	body: "paragraphs",
};

const TOPIC_BASELINE: BaselineSource = {
	id: "S001",
	days: 30,
	max_items: null,
	fetch: TOPIC_FETCH,
};

const SITEMAP_BASELINE: BaselineSource = {
	id: "S002",
	days: 30,
	max_items: null,
	fetch: {
		type: "sitemap",
		url: "https://insight.factset.com/sitemap.xml",
		include: "^https://insight\\.factset\\.com/[^/]+$",
		body: "paragraphs",
	},
};

function testConfig(
	name: string,
	baselineSources: DiscoveryConfig["baseline"]["sources"],
): DiscoveryConfig {
	fs.writeJsonSync(path.join(TEST_DIR, "registry.json"), {
		schema_version: "byosan_discovery_sources_v1",
		sources: REGISTRY_SOURCES,
	});
	return {
		...CONFIG,
		registry: REGISTRY,
		baseline: {
			path: path.relative(ROOT, path.join(TEST_DIR, name)),
			sources: baselineSources,
		},
	};
}

async function discover(
	cfg: DiscoveryConfig,
	name: string,
): Promise<{
	articles: { feed: string; title: string; url: string; body: string }[];
	excluded: { feed: string; url: string; reason: string }[];
}> {
	const runDir = path.join(TEST_DIR, name);
	await writeDiscoveryEvidence(cfg, runDir, NOW);
	return {
		articles: fs.readJsonSync(
			path.join(runDir, "research", "discovery_articles.json"),
		),
		excluded: fs.readJsonSync(
			path.join(runDir, "research", "discovery_excluded.json"),
		),
	};
}

describe("byosan feed discovery", () => {
	beforeEach(() => {
		const routed = async (input: string | Request | URL) =>
			new Response(ROUTES[String(input)] ?? "", { status: 200 });
		spyOn(globalThis, "fetch").mockImplementation(routed as typeof fetch);
	});

	afterEach(() => {
		mock.restore();
	});

	test("records one failed feed and continues with other sources", async () => {
		const failedUrl = REGISTRY_SOURCES[0]?.fetch;
		if (!failedUrl || !("url" in failedUrl))
			throw new Error("missing feed URL");
		const routed = async (input: string | Request | URL) =>
			String(input) === failedUrl.url
				? new Response("unavailable", { status: 503 })
				: new Response(ROUTES[String(input)] ?? "", { status: 200 });
		spyOn(globalThis, "fetch").mockImplementation(routed as typeof fetch);
		const { articles, excluded } = await discover(
			testConfig("failed.json", []),
			"failed-run",
		);
		expect(articles.length).toBeGreaterThan(0);
		expect(
			excluded.some(
				(item) =>
					item.feed === REGISTRY_SOURCES[0]?.id &&
					item.reason.includes("FETCH_FAILED 503"),
			),
		).toBe(true);
	});

	test("does not hide unexpected discovery errors", async () => {
		const broken = async () => {
			throw new Error("unexpected parser defect");
		};
		spyOn(globalThis, "fetch").mockImplementation(
			broken as unknown as typeof fetch,
		);
		await expect(
			discover(testConfig("defect.json", []), "defect-run"),
		).rejects.toThrow("unexpected parser defect");
	});

	test("takes the article paragraphs as the body and excludes a page whose title does not match", async () => {
		const { articles, excluded } = await discover(
			testConfig("rss.json", []),
			"rss-run",
		);
		expect(articles.find((a) => a.url === ARTICLE_URL)?.body).toBe(
			`${LONG_1}\n${LONG_2}`,
		);
		expect(excluded).toContainEqual({
			feed: "S001",
			url: MISMATCH_URL,
			reason: `Error: TITLE_MISMATCH ${MISMATCH_URL}`,
		});
	});

	test("builds the filing body from the XBRL quarter and excludes filings without XBRL facts", async () => {
		const { articles, excluded } = await discover(
			testConfig("sec.json", []),
			"sec-run",
		);
		const nvidia = articles.find((a) => a.feed === "S009");
		expect(nvidia?.body).toContain(
			"- 売上: 96221000000 USD（実績（提出書類）、10-Q 2026-04-27〜2026-07-26、提出日 2026-08-26、Revenues）",
		);
		expect(excluded).toContainEqual({
			feed: "S008",
			url: `https://www.sec.gov/Archives/edgar/data/723125/${MICRON_8K.replaceAll("-", "")}/mu-20261022.htm`,
			reason: `Error: XBRL_FACTS_NOT_FOUND ${MICRON_8K}`,
		});
		expect(excluded).toContainEqual({
			feed: "S010",
			url: `https://www.sec.gov/Archives/edgar/data/1046179/${TSMC_6K.replaceAll("-", "")}/tsm-monthend6k.htm`,
			reason: `Error: XBRL_FACTS_NOT_FOUND ${TSMC_6K}`,
		});
		expect(
			excluded.some(
				(item) =>
					item.feed === "S010" && item.reason.startsWith("NO_ITEMS_RETURNED"),
			),
		).toBe(true);
	});

	test("keeps one copy of each baseline article, drops articles outside the window, and fetches nothing twice", async () => {
		const cfg = testConfig("baseline.json", [TOPIC_BASELINE, SITEMAP_BASELINE]);
		fs.writeJsonSync(path.join(ROOT, cfg.baseline.path), [
			{
				feed: "S002",
				issuer: "FactSet Insight",
				caution: "予想と実績を区別",
				title: "Stale",
				url: SITEMAP_OLD_URL,
				published: "2026-08-01T00:00:00.000Z",
				body: "stale",
			},
		]);
		await discover(cfg, "baseline-first");
		const stored = loadDiscoveryBaseline(cfg, NOW);
		expect(stored.map((a) => [a.feed, a.url]).sort()).toEqual(
			[
				["S001", ARTICLE_URL],
				["S001", TOPIC_NEW_URL],
				["S002", SITEMAP_NEW_URL],
			].sort(),
		);

		const fetched: string[] = [];
		const routed = async (input: string | Request | URL) => {
			fetched.push(String(input));
			return new Response(ROUTES[String(input)] ?? "", { status: 200 });
		};
		spyOn(globalThis, "fetch").mockImplementation(routed as typeof fetch);
		await discover(cfg, "baseline-second");
		expect(fetched).not.toContain(TOPIC_NEW_URL);
		expect(fetched).not.toContain(SITEMAP_NEW_URL);
		expect(fetched.filter((url) => url === ARTICLE_URL)).toHaveLength(1);
	});

	test("records the gap when the listing runs out of configured pages inside the window", async () => {
		const cfg = testConfig("pages.json", [
			{ ...TOPIC_BASELINE, fetch: { ...TOPIC_FETCH, pages: 1 } },
		]);
		const { excluded } = await discover(cfg, "pages-run");
		expect(excluded).toContainEqual({
			feed: "S001",
			url: TOPIC_URL,
			reason: "PAGE_LIMIT_REACHED pages=1",
		});
	});
});
