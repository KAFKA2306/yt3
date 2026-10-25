import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../../io/core.js";

export type SourceFetch =
	| { type: "rss"; url: string }
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
	cfg: DiscoveryConfig,
	init: RequestInit = {},
): Promise<string> {
	const res = await fetch(url, {
		...init,
		headers: {
			"user-agent": cfg.user_agent,
			accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"accept-language": "en-US,en;q=0.9",
		},
	});
	if (!res.ok) throw new Error(`FETCH_FAILED ${res.status} ${url}`);
	return res.text();
}

function iso(value: string): string {
	return new Date(value).toISOString();
}

function articleBody(html: string, cfg: DiscoveryConfig): string {
	const main = html.match(/<(article|main)[\s\S]*?<\/\1>/)?.[0] ?? html;
	return plain(main).slice(0, cfg.body_chars);
}

async function fromRss(
	f: Extract<SourceFetch, { type: "rss" }>,
	cfg: DiscoveryConfig,
): Promise<Entry[]> {
	const xml = await get(f.url, cfg);
	return (xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []).map((item) => ({
		title: plain(tag(item, "title")),
		url: plain(tag(item, "link")),
		published: iso(tag(item, "pubDate") || tag(item, "dc:date")),
		body: plain(tag(item, "content:encoded") || tag(item, "description")).slice(
			0,
			cfg.body_chars,
		),
	}));
}

async function fromPage(
	url: string,
	published: string | undefined,
	cfg: DiscoveryConfig,
): Promise<Entry> {
	const html = await get(url, cfg);
	const date =
		published ??
		html.match(/"datePublished":\s*"([^"]+)"/)?.[1] ??
		meta(html, "article:published_time");
	return {
		title: meta(html, "og:title") || plain(tag(html, "title")),
		url,
		published: iso(date),
		body: articleBody(html, cfg),
	};
}

async function fromSitemap(
	f: Extract<SourceFetch, { type: "sitemap" }>,
	cfg: DiscoveryConfig,
	cutoff: number,
): Promise<Entry[]> {
	const xml = await get(f.url, cfg);
	const include = new RegExp(f.include);
	const urls = [
		...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g),
	]
		.map((m) => ({ url: m[1] as string, lastmod: m[2] as string }))
		.filter(
			(u) => include.test(u.url) && new Date(u.lastmod).getTime() >= cutoff,
		)
		.sort((a, b) => b.lastmod.localeCompare(a.lastmod))
		.slice(0, cfg.max_items_per_feed);
	return Promise.all(urls.map((u) => fromPage(u.url, u.lastmod, cfg)));
}

async function fromHtmlList(
	f: Extract<SourceFetch, { type: "html_list" }>,
	cfg: DiscoveryConfig,
): Promise<Entry[]> {
	const html = await get(f.url, cfg);
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
		.slice(0, cfg.max_items_per_feed);
	return Promise.all(
		links.map(async (url) => {
			const page = await get(url, cfg);
			const ymd = url.match(/(\d{4})(\d{2})(\d{2})/);
			const date =
				page.match(/"datePublished":\s*"([^"]+)"/)?.[1] ??
				`${ymd?.[1]}-${ymd?.[2]}-${ymd?.[3]}T00:00:00+09:00`;
			return {
				title: meta(page, "og:title") || plain(tag(page, "title")),
				url,
				published: iso(date),
				body: articleBody(page, cfg),
			};
		}),
	);
}

async function fromPostApi(
	f: Extract<SourceFetch, { type: "post_api" }>,
	cfg: DiscoveryConfig,
): Promise<Entry[]> {
	const html = await get(f.url, cfg, { method: "POST" });
	const items = [...html.matchAll(/<li>[\s\S]*?<\/li>/g)]
		.map((m) => m[0])
		.slice(0, cfg.max_items_per_feed);
	return Promise.all(
		items.map(async (item) => {
			const href = item.match(/<a href="([^"]+)"/)?.[1] as string;
			const date = (
				item.match(/class="date">([\d.]+)</)?.[1] as string
			).replaceAll(".", "-");
			const url = `${f.base}${href}`;
			const page = await get(url, cfg);
			return {
				title: plain(item.match(/<a href="[^"]+">([\s\S]*?)<a>/)?.[1] ?? ""),
				url,
				published: iso(`${date}T00:00:00+09:00`),
				body: articleBody(page, cfg),
			};
		}),
	);
}

async function fromSec(
	f: Extract<SourceFetch, { type: "sec" }>,
	cfg: DiscoveryConfig,
	source: DiscoverySource,
): Promise<Entry[]> {
	const json = JSON.parse(
		await get(`https://data.sec.gov/submissions/CIK${f.cik}.json`, cfg),
	) as {
		name: string;
		filings: {
			recent: {
				form: string[];
				filingDate: string[];
				accessionNumber: string[];
				primaryDocument: string[];
				items: string[];
				reportDate: string[];
			};
		};
	};
	const r = json.filings.recent;
	const rows = r.form
		.map((form, i) => ({
			form,
			date: r.filingDate[i] as string,
			acc: (r.accessionNumber[i] as string).replaceAll("-", ""),
			doc: r.primaryDocument[i] as string,
			items: r.items[i] as string,
			reportDate: r.reportDate[i] as string,
		}))
		.filter((x) => f.forms.includes(x.form))
		.slice(0, cfg.max_items_per_feed);
	return rows.map((x) => ({
		title: `${json.name} ${x.form} ${x.date} (${source.id})`,
		url: `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${x.acc}/${x.doc}`,
		published: iso(`${x.date}T00:00:00Z`),
		body: `SEC提出書類。様式: ${x.form}。提出日: ${x.date}。報告期間末日: ${x.reportDate || "なし"}。8-K項目: ${x.items || "なし"}。本文はURLの一次開示で確認する。`,
	}));
}

async function crawl(
	source: DiscoverySource,
	cfg: DiscoveryConfig,
	cutoff: number,
): Promise<Entry[]> {
	const f = source.fetch;
	switch (f.type) {
		case "rss":
			return fromRss(f, cfg);
		case "sitemap":
			return fromSitemap(f, cfg, cutoff);
		case "html_list":
			return fromHtmlList(f, cfg);
		case "post_api":
			return fromPostApi(f, cfg);
		case "sec":
			return fromSec(f, cfg, source);
		default:
			return [];
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
): Promise<DiscoveredArticle[]> {
	const cutoff = now.getTime() - cfg.recent_days * 86_400_000;
	const perSource = await Promise.all(
		loadDiscoverySources(cfg).map(async (source) =>
			(await crawl(source, cfg, cutoff))
				.filter((a) => new Date(a.published).getTime() >= cutoff)
				.slice(0, cfg.max_items_per_feed)
				.map((a) => ({
					...a,
					feed: source.id,
					issuer: source.issuer,
					caution: source.caution,
				})),
		),
	);
	const seen = new Set<string>();
	return perSource
		.flat()
		.filter((a) => !seen.has(a.url) && seen.add(a.url))
		.sort((a, b) => b.published.localeCompare(a.published));
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
	const articles = await discoverArticles(cfg, now);
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
	return file;
}
