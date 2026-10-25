import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../../io/core.js";
import { type SecConfig, loadSecConfig } from "./sec_xbrl.js";

export type SourceFetch =
	| { type: "rss"; url: string; body: "feed" | "paragraphs" }
	| { type: "sitemap"; url: string; include: string }
	| { type: "html_list"; url: string; link: string }
	| { type: "post_api"; url: string; base: string }
	| { type: "sec"; cik: string; forms: string[] }
	| { type: "verify" }
	| { type: "unreachable"; reason: string };

type DiscoverySource = {
	id: string;
	issuer: string;
	url: string;
	status: string;
	caution: string;
	fetch: SourceFetch;
};

export type DiscoveryConfig = {
	recent_days: number;
	max_items_per_feed: number;
	body_chars: number;
	min_paragraph_chars: number;
	earnings_item: string;
	press_release_exhibit: string;
	title_rule: string;
	registry: string;
	user_agent: string;
};

type DiscoveredArticle = {
	feed: string;
	issuer: string;
	caution: string;
	title: string;
	url: string;
	published: string;
	body: string;
};

type Entry = Pick<DiscoveredArticle, "title" | "url" | "published" | "body">;

type Known = { url: string; title?: string; published?: string };

type FeedItem = { url: string; title: string; published: string };

type Filing = {
	form: string;
	date: string;
	items: string;
	accession: string;
	url: string;
	index: string;
};

type Exclusion = { feed: string; url: string; reason: string };

type Crawl = { entries: Entry[]; excluded: Exclusion[] };

const ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&nbsp;": " ",
};

function decode(text: string): string {
	return text.replace(
		/&(amp|lt|gt|quot|#39|nbsp);/g,
		(m) => ENTITIES[m] as string,
	);
}

function plain(html: string): string {
	return decode(
		decode(html)
			.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/\s+/g, " ")
		.trim();
}

function tag(block: string, name: string): string {
	const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
	return (m?.[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function meta(html: string, property: string): string {
	const m = html.match(
		new RegExp(
			`<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]*)"`,
		),
	);
	return decode(m?.[1] ?? "").trim();
}

async function get(
	url: string,
	userAgent: string,
	init: RequestInit = {},
): Promise<string> {
	const res = await fetch(url, {
		...init,
		headers: {
			"user-agent": userAgent,
			accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"accept-language": "en-US,en;q=0.9",
		},
	});
	if (!res.ok) throw new Error(`FETCH_FAILED ${res.status} ${url}`);
	return res.text();
}

let nextSecRequestAt = 0;

async function secGet(url: string, sec: SecConfig): Promise<string> {
	const slot = Math.max(Date.now(), nextSecRequestAt);
	nextSecRequestAt = slot + sec.min_interval_ms;
	await Bun.sleep(Math.max(0, slot - Date.now()));
	return get(url, sec.user_agent);
}

function iso(value: string): string {
	return new Date(value).toISOString();
}

function ymdDate(url: string): string | undefined {
	const ymd = url.match(/(\d{4})(\d{2})(\d{2})/);
	return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00+09:00` : undefined;
}

function articleBody(html: string, cfg: DiscoveryConfig): string {
	const main = html.match(/<(article|main)[\s\S]*?<\/\1>/)?.[0] ?? html;
	return plain(main).slice(0, cfg.body_chars);
}

function paragraphBody(html: string, cfg: DiscoveryConfig): string {
	const paragraphs = [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)].map(
		(m) => plain(m[1] ?? ""),
	);
	const runs: string[][] = [];
	let run: string[] = [];
	for (const text of paragraphs) {
		if (text.length >= cfg.min_paragraph_chars) {
			run.push(text);
		} else {
			runs.push(run);
			run = [];
		}
	}
	runs.push(run);
	const longest = runs.reduce<string[]>(
		(best, current) =>
			current.join(" ").length > best.join(" ").length ? current : best,
		[],
	);
	return longest.join("\n").slice(0, cfg.body_chars);
}

async function settle<T extends { url: string }>(
	feed: string,
	items: T[],
	read: (item: T) => Promise<Entry>,
): Promise<Crawl> {
	const outcomes = await Promise.all(
		items.map((item) =>
			read(item).then(
				(entry) => ({ entry }),
				(error: unknown) => ({
					exclusion: { feed, url: item.url, reason: String(error) },
				}),
			),
		),
	);
	return {
		entries: outcomes.flatMap((o) => ("entry" in o ? [o.entry] : [])),
		excluded: outcomes.flatMap((o) => ("exclusion" in o ? [o.exclusion] : [])),
	};
}

async function fromPage(item: Known, cfg: DiscoveryConfig): Promise<Entry> {
	const html = await get(item.url, cfg.user_agent);
	const date =
		item.published ??
		html.match(/"datePublished":\s*"([^"]+)"/)?.[1] ??
		meta(html, "article:published_time");
	return {
		title: item.title || meta(html, "og:title") || plain(tag(html, "title")),
		url: item.url,
		published: iso(date),
		body: articleBody(html, cfg),
	};
}

async function fromFeedArticle(
	item: FeedItem,
	cfg: DiscoveryConfig,
): Promise<Entry> {
	const html = await get(item.url, cfg.user_agent);
	if (meta(html, "og:title") !== item.title) {
		throw new Error(`TITLE_MISMATCH ${item.url}`);
	}
	const body = paragraphBody(html, cfg);
	if (body === "") throw new Error(`BODY_EMPTY ${item.url}`);
	return { title: item.title, url: item.url, published: item.published, body };
}

async function fromRss(
	f: Extract<SourceFetch, { type: "rss" }>,
	cfg: DiscoveryConfig,
	feed: string,
	cutoff: number,
): Promise<Crawl> {
	const xml = await get(f.url, cfg.user_agent);
	const items = (xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [])
		.map((item) => ({
			title: plain(tag(item, "title")),
			url: plain(tag(item, "link")),
			published: iso(tag(item, "pubDate") || tag(item, "dc:date")),
			feedBody: plain(
				tag(item, "content:encoded") || tag(item, "description"),
			).slice(0, cfg.body_chars),
		}))
		.filter((item) => new Date(item.published).getTime() >= cutoff)
		.slice(0, cfg.max_items_per_feed);
	if (f.body === "feed") {
		return {
			entries: items.map(({ feedBody, ...item }) => ({
				...item,
				body: feedBody,
			})),
			excluded: [],
		};
	}
	return settle(feed, items, (item) => fromFeedArticle(item, cfg));
}

async function fromSitemap(
	f: Extract<SourceFetch, { type: "sitemap" }>,
	cfg: DiscoveryConfig,
	feed: string,
	cutoff: number,
): Promise<Crawl> {
	const xml = await get(f.url, cfg.user_agent);
	const include = new RegExp(f.include);
	const urls = [
		...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g),
	]
		.map((m) => ({ url: m[1] as string, lastmod: m[2] as string }))
		.filter(
			(u) => include.test(u.url) && new Date(u.lastmod).getTime() >= cutoff,
		)
		.sort((a, b) => b.lastmod.localeCompare(a.lastmod))
		.slice(0, cfg.max_items_per_feed)
		.map((u) => ({ url: u.url, published: u.lastmod }));
	return settle(feed, urls, (item) => fromPage(item, cfg));
}

async function fromHtmlList(
	f: Extract<SourceFetch, { type: "html_list" }>,
	cfg: DiscoveryConfig,
	feed: string,
): Promise<Crawl> {
	const html = await get(f.url, cfg.user_agent);
	const origin = new URL(f.url).origin;
	const links = [
		...new Set(
			[
				...html.matchAll(
					new RegExp(`href="(?:https?://[^/"]+)?(${f.link})"`, "g"),
				),
			].map((m) => `${origin}${m[1]}`),
		),
	]
		.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
		.slice(0, cfg.max_items_per_feed)
		.map((url) => ({ url, published: ymdDate(url) }));
	return settle(feed, links, (item) => fromPage(item, cfg));
}

async function fromPostApi(
	f: Extract<SourceFetch, { type: "post_api" }>,
	cfg: DiscoveryConfig,
	feed: string,
): Promise<Crawl> {
	const html = await get(f.url, cfg.user_agent, { method: "POST" });
	const items = [...html.matchAll(/<li>[\s\S]*?<\/li>/g)]
		.map((m) => m[0])
		.slice(0, cfg.max_items_per_feed)
		.map((item) => {
			const href = item.match(/<a href="([^"]+)"/)?.[1] as string;
			const date = (
				item.match(/class="date">([\d.]+)</)?.[1] as string
			).replaceAll(".", "-");
			return {
				url: `${f.base}${href}`,
				title: plain(item.match(/<a href="[^"]+">([\s\S]*?)<a>/)?.[1] ?? ""),
				published: iso(`${date}T00:00:00+09:00`),
			};
		});
	return settle(feed, items, (item) => fromPage(item, cfg));
}

async function fromFiling(
	x: Filing,
	name: string,
	cfg: DiscoveryConfig,
	feed: string,
	sec: SecConfig,
): Promise<Entry> {
	const index = await secGet(x.index, sec);
	const exhibits = index
		.split("<tr")
		.filter((row) => row.includes(`>${cfg.press_release_exhibit}<`))
		.flatMap((row) => {
			const href = row.match(/href="([^"]+)"/)?.[1];
			return href ? [new URL(href, "https://www.sec.gov").href] : [];
		});
	if (x.items.split(",").includes(cfg.earnings_item) && exhibits.length === 0) {
		throw new Error(`EXHIBIT_NOT_FOUND ${cfg.press_release_exhibit} ${x.url}`);
	}
	const texts = await Promise.all(
		[...exhibits, x.url].map(async (url) => plain(await secGet(url, sec))),
	);
	return {
		title: `${name} ${x.form} ${x.date} (${feed})`,
		url: x.url,
		published: iso(`${x.date}T00:00:00Z`),
		body: texts.join("\n").slice(0, cfg.body_chars),
	};
}

async function fromSec(
	f: Extract<SourceFetch, { type: "sec" }>,
	cfg: DiscoveryConfig,
	feed: string,
	cutoff: number,
): Promise<Crawl> {
	const sec = loadSecConfig();
	const json = JSON.parse(
		await secGet(`https://data.sec.gov/submissions/CIK${f.cik}.json`, sec),
	) as {
		name: string;
		filings: {
			recent: {
				form: string[];
				filingDate: string[];
				accessionNumber: string[];
				primaryDocument: string[];
				items: string[];
			};
		};
	};
	const r = json.filings.recent;
	const filings = r.form
		.map((form, i): Filing => {
			const accession = r.accessionNumber[i] as string;
			const dir = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${accession.replaceAll("-", "")}/`;
			return {
				form,
				date: r.filingDate[i] as string,
				items: r.items[i] as string,
				accession,
				url: `${dir}${r.primaryDocument[i] as string}`,
				index: `${dir}${accession}-index.htm`,
			};
		})
		.filter(
			(x) =>
				f.forms.includes(x.form) &&
				new Date(`${x.date}T00:00:00Z`).getTime() >= cutoff,
		)
		.slice(0, cfg.max_items_per_feed);
	return settle(feed, filings, (x) => fromFiling(x, json.name, cfg, feed, sec));
}

async function crawl(
	source: DiscoverySource,
	cfg: DiscoveryConfig,
	cutoff: number,
): Promise<Crawl> {
	const f = source.fetch;
	switch (f.type) {
		case "rss":
			return fromRss(f, cfg, source.id, cutoff);
		case "sitemap":
			return fromSitemap(f, cfg, source.id, cutoff);
		case "html_list":
			return fromHtmlList(f, cfg, source.id);
		case "post_api":
			return fromPostApi(f, cfg, source.id);
		case "sec":
			return fromSec(f, cfg, source.id, cutoff);
		default:
			return { entries: [], excluded: [] };
	}
}

export function loadDiscoverySources(cfg: DiscoveryConfig): DiscoverySource[] {
	return (
		fs.readJsonSync(path.join(ROOT, cfg.registry)) as {
			sources: DiscoverySource[];
		}
	).sources.filter((source) => source.status === "採用");
}

async function discoverArticles(
	cfg: DiscoveryConfig,
	now: Date,
): Promise<{ articles: DiscoveredArticle[]; excluded: Exclusion[] }> {
	const cutoff = now.getTime() - cfg.recent_days * 86_400_000;
	const perSource = await Promise.all(
		loadDiscoverySources(cfg).map(async (source) => {
			const { entries, excluded } = await crawl(source, cfg, cutoff);
			return {
				excluded,
				articles: entries
					.filter((a) => new Date(a.published).getTime() >= cutoff)
					.slice(0, cfg.max_items_per_feed)
					.map((a) => ({
						...a,
						feed: source.id,
						issuer: source.issuer,
						caution: source.caution,
					})),
			};
		}),
	);
	const seen = new Set<string>();
	const articles = perSource
		.flatMap((s) => s.articles)
		.filter((a) => !seen.has(a.url) && seen.add(a.url))
		.sort((a, b) => b.published.localeCompare(a.published));
	return { articles, excluded: perSource.flatMap((s) => s.excluded) };
}

function renderDiscoveryEvidence(
	articles: DiscoveredArticle[],
	notCrawled: DiscoverySource[],
	fetchedAt: string,
): string {
	return [
		`# 新着記事（登録媒体 / 取得 ${fetchedAt}）`,
		"題材はこの一覧の中からのみ選ぶ。記事本文の数値を一次データ（企業IR・SEC・統計原典）で検証できないものは採用しない。",
		...articles.map(
			(a) =>
				`\n## ${a.title}\n- 媒体: ${a.issuer}\n- 公開: ${a.published}\n- URL: ${a.url}\n- 公開時の注意: ${a.caution}\n\n${a.body}`,
		),
		`\n## 今回巡回していない登録媒体\n${notCrawled.map((u) => `- ${u.id} ${u.issuer} ${u.url} (${u.fetch.type}${u.fetch.type === "unreachable" ? `: ${u.fetch.reason}` : ""})`).join("\n")}`,
	].join("\n");
}

export async function writeDiscoveryEvidence(
	cfg: DiscoveryConfig,
	runDir: string,
	now: Date,
): Promise<string> {
	const { articles, excluded } = await discoverArticles(cfg, now);
	if (articles.length === 0) {
		throw new Error(
			"BYOSAN_ANGLE_STOP: no recent articles in registered sources",
		);
	}
	const file = path.join(runDir, "research", "discovery_evidence.md");
	await fs.outputFile(
		file,
		renderDiscoveryEvidence(
			articles,
			loadDiscoverySources(cfg).filter((s) =>
				["verify", "unreachable"].includes(s.fetch.type),
			),
			now.toISOString(),
		),
	);
	await fs.outputJson(
		path.join(runDir, "research", "discovery_articles.json"),
		articles,
		{ spaces: 2 },
	);
	await fs.outputJson(
		path.join(runDir, "research", "discovery_excluded.json"),
		excluded,
		{ spaces: 2 },
	);
	return file;
}
