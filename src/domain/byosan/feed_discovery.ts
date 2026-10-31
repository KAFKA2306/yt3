import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../../io/core.js";
import {
	accessionFigures,
	type ConceptFact,
	type Figure,
	loadSecConfig,
	parseCompanyFacts,
	type SecConfig,
} from "./sec_xbrl.js";

type Body = "article" | "paragraphs";

export type SourceFetch =
	| { type: "rss"; url: string; body: "feed" | "paragraphs" }
	| { type: "sitemap"; url: string; include: string; body: Body }
	| { type: "html_list"; url: string; link: string; body: Body }
	| {
			type: "html_items";
			url: string;
			page_url: string;
			pages: number;
			item: string;
			link: string;
			body: Body;
	  }
	| { type: "post_api"; url: string; base: string; body: Body }
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

type BaselineSource = {
	id: string;
	days: number;
	max_items: number | null;
	fetch: Extract<SourceFetch, { type: "sitemap" | "html_items" }>;
};

export type DiscoveryConfig = {
	recent_days: number;
	max_items_per_feed: number;
	body_chars: number;
	min_paragraph_chars: number;
	concurrency: number;
	title_rule: string;
	registry: string;
	user_agent: string;
	owner_articles: string;
	baseline: { path: string; sources: BaselineSource[] };
};

export type DiscoveredArticle = {
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

type Listed = { url: string; published?: string };

type FeedItem = { url: string; title: string; published: string };

type Filing = {
	form: string;
	date: string;
	accession: string;
	url: string;
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

function listedDate(text: string): string {
	return new Date(`${text} UTC`).toISOString();
}

function ymdDate(url: string): string | undefined {
	const ymd = url.match(/(\d{4})-?(\d{2})-?(\d{2})/);
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

function bodyOf(html: string, cfg: DiscoveryConfig, body: Body): string {
	return body === "article" ? articleBody(html, cfg) : paragraphBody(html, cfg);
}

async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i] as T);
		}
	};
	await Promise.all(Array.from({ length: limit }, worker));
	return out;
}

async function settle<T extends { url: string }>(
	feed: string,
	items: T[],
	read: (item: T) => Promise<Entry>,
	concurrency: number,
): Promise<Crawl> {
	const outcomes = await mapLimit(items, concurrency, (item) =>
		read(item).then(
			(entry) => ({ entry }),
			(error: unknown) => ({
				exclusion: { feed, url: item.url, reason: String(error) },
			}),
		),
	);
	return {
		entries: outcomes.flatMap((o) => ("entry" in o ? [o.entry] : [])),
		excluded: outcomes.flatMap((o) => ("exclusion" in o ? [o.exclusion] : [])),
	};
}

function readListed(
	feed: string,
	listed: Listed[],
	body: Body,
	cfg: DiscoveryConfig,
): Promise<Crawl> {
	return settle(
		feed,
		listed,
		(item) => fromPage(item, cfg, body),
		cfg.concurrency,
	);
}

async function fromPage(
	item: Known,
	cfg: DiscoveryConfig,
	body: Body,
): Promise<Entry> {
	const html = await get(item.url, cfg.user_agent);
	const date =
		item.published ??
		html.match(/"datePublished":\s*"([^"]+)"/)?.[1] ??
		meta(html, "article:published_time");
	return {
		title: item.title || meta(html, "og:title") || plain(tag(html, "title")),
		url: item.url,
		published: iso(date),
		body: bodyOf(html, cfg, body),
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
	return settle(
		feed,
		items,
		(item) => fromFeedArticle(item, cfg),
		cfg.concurrency,
	);
}

async function listSitemap(
	f: Extract<SourceFetch, { type: "sitemap" }>,
	cfg: DiscoveryConfig,
	cutoff: number,
	limit: number | null,
): Promise<Listed[]> {
	const xml = await get(f.url, cfg.user_agent);
	const include = new RegExp(f.include);
	const urls = (xml.match(/<url>[\s\S]*?<\/url>/g) ?? [])
		.map((block) => ({
			url: tag(block, "loc"),
			lastmod: tag(block, "lastmod"),
		}))
		.filter(
			(u) => include.test(u.url) && new Date(u.lastmod).getTime() >= cutoff,
		)
		.sort((a, b) => b.lastmod.localeCompare(a.lastmod))
		.map((u) => ({ url: u.url, published: u.lastmod }));
	return limit === null ? urls : urls.slice(0, limit);
}

async function listHtmlLinks(
	f: Extract<SourceFetch, { type: "html_list" }>,
	cfg: DiscoveryConfig,
): Promise<Listed[]> {
	const html = await get(f.url, cfg.user_agent);
	const origin = new URL(f.url).origin;
	return [
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
}

async function listHtmlItems(
	feed: string,
	f: Extract<SourceFetch, { type: "html_items" }>,
	cfg: DiscoveryConfig,
	cutoff: number,
	limit: number | null,
): Promise<{ listed: Listed[]; excluded: Exclusion[] }> {
	const item = new RegExp(f.item, "g");
	const link = new RegExp(f.link);
	const found = new Map<string, Listed>();
	let reachedEnd = false;
	for (let page = 1; page <= f.pages; page++) {
		const html = await get(
			page === 1 ? f.url : f.page_url.replace("{n}", String(page)),
			cfg.user_agent,
		);
		const items = [...html.matchAll(item)].map((m) => ({
			url: new URL(m.groups?.url ?? "", f.url).href,
			published: listedDate(m.groups?.date ?? ""),
		}));
		if (items.length === 0)
			throw new Error(`ITEM_NOT_FOUND ${feed} page=${page}`);
		const inWindow = items.filter(
			(x) => new Date(x.published).getTime() >= cutoff,
		);
		if (inWindow.length === 0) {
			reachedEnd = true;
			break;
		}
		for (const x of inWindow) {
			if (link.test(x.url)) found.set(x.url, x);
		}
	}
	const listed = [...found.values()];
	return {
		listed: limit === null ? listed : listed.slice(0, limit),
		excluded: reachedEnd
			? []
			: [{ feed, url: f.url, reason: `PAGE_LIMIT_REACHED pages=${f.pages}` }],
	};
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
			const rawDate = item.match(/class="date">([\d.]+)</)?.[1];
			if (!rawDate) throw new Error(`POST_API_DATE_MISSING ${feed}`);
			const date = rawDate.replaceAll(".", "-");
			return {
				url: `${f.base}${href}`,
				title: plain(item.match(/<a href="[^"]+">([\s\S]*?)<a>/)?.[1] ?? ""),
				published: iso(`${date}T00:00:00+09:00`),
			};
		});
	return readListed(feed, items, f.body, cfg);
}

function figureLine({ label, tag: concept, fact }: Figure): string {
	const period =
		fact.start === undefined ? `${fact.end}時点` : `${fact.start}〜${fact.end}`;
	return `- ${label}: ${fact.val} ${fact.unit}（実績（提出書類）、${fact.form} ${period}、提出日 ${fact.filed}、${concept}）`;
}

function fromFiling(
	x: Filing,
	name: string,
	facts: readonly ConceptFact[],
	sec: SecConfig,
	feed: string,
): Entry {
	return {
		title: `${name} ${x.form} ${x.date} (${feed})`,
		url: x.url,
		published: iso(`${x.date}T00:00:00Z`),
		body: accessionFigures(facts, x.accession, sec).map(figureLine).join("\n"),
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
				accession,
				url: `${dir}${r.primaryDocument[i] as string}`,
			};
		})
		.filter(
			(x) =>
				f.forms.includes(x.form) &&
				new Date(`${x.date}T00:00:00Z`).getTime() >= cutoff,
		)
		.slice(0, cfg.max_items_per_feed);
	if (filings.length === 0) return { entries: [], excluded: [] };
	const facts = parseCompanyFacts(
		JSON.parse(
			await secGet(
				`https://data.sec.gov/api/xbrl/companyfacts/CIK${f.cik}.json`,
				sec,
			),
		),
	);
	return settle(
		feed,
		filings,
		async (x) => fromFiling(x, json.name, facts, sec, feed),
		cfg.concurrency,
	);
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
			return readListed(
				source.id,
				await listSitemap(f, cfg, cutoff, cfg.max_items_per_feed),
				f.body,
				cfg,
			);
		case "html_list":
			return readListed(source.id, await listHtmlLinks(f, cfg), f.body, cfg);
		case "html_items": {
			const { listed, excluded } = await listHtmlItems(
				source.id,
				f,
				cfg,
				cutoff,
				cfg.max_items_per_feed,
			);
			const read = await readListed(source.id, listed, f.body, cfg);
			return {
				entries: read.entries,
				excluded: [...excluded, ...read.excluded],
			};
		}
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
			let result: Crawl;
			try {
				result = await crawl(source, cfg, cutoff);
			} catch (error) {
				if (
					!(error instanceof Error) ||
					(!error.message.startsWith("FETCH_FAILED ") &&
						!(error instanceof TypeError && /fetch/i.test(error.message)))
				) {
					throw error;
				}
				return {
					excluded: [
						{ feed: source.id, url: source.url, reason: String(error) },
					],
					articles: [],
				};
			}
			const { entries, excluded } = result;
			if (
				entries.length === 0 &&
				source.fetch.type !== "verify" &&
				source.fetch.type !== "unreachable"
			) {
				excluded.push({
					feed: source.id,
					url: source.url,
					reason: "NO_ITEMS_RETURNED (may be no new publications)",
				});
			}
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

function windowed(
	articles: DiscoveredArticle[],
	cfg: DiscoveryConfig,
	now: Date,
): DiscoveredArticle[] {
	const days = new Map(cfg.baseline.sources.map((b) => [b.id, b.days]));
	const seen = new Set<string>();
	return articles
		.filter((a) => {
			const d = days.get(a.feed);
			if (
				d === undefined ||
				seen.has(a.url) ||
				new Date(a.published).getTime() < now.getTime() - d * 86_400_000
			) {
				return false;
			}
			seen.add(a.url);
			return true;
		})
		.sort((a, b) => b.published.localeCompare(a.published));
}

function readBaselineStore(cfg: DiscoveryConfig): DiscoveredArticle[] {
	const file = path.join(ROOT, cfg.baseline.path);
	return fs.existsSync(file)
		? (fs.readJsonSync(file) as DiscoveredArticle[])
		: [];
}

export function loadDiscoveryBaseline(
	cfg: DiscoveryConfig,
	now: Date,
): DiscoveredArticle[] {
	return windowed(readBaselineStore(cfg), cfg, now);
}

async function updateDiscoveryBaseline(
	cfg: DiscoveryConfig,
	now: Date,
	daily: DiscoveredArticle[],
): Promise<Exclusion[]> {
	const stored = readBaselineStore(cfg);
	const sources = loadDiscoverySources(cfg);
	const known = new Set([...stored, ...daily].map((a) => a.url));
	const fetched: DiscoveredArticle[] = [];
	const excluded: Exclusion[] = [];
	for (const b of cfg.baseline.sources) {
		const source = sources.find((s) => s.id === b.id);
		if (source === undefined)
			throw new Error(`BASELINE_SOURCE_NOT_ADOPTED ${b.id}`);
		const cutoff = now.getTime() - b.days * 86_400_000;
		const listing =
			b.fetch.type === "sitemap"
				? {
						listed: await listSitemap(b.fetch, cfg, cutoff, b.max_items),
						excluded: [] as Exclusion[],
					}
				: await listHtmlItems(b.id, b.fetch, cfg, cutoff, b.max_items);
		const read = await readListed(
			b.id,
			listing.listed.filter((x) => !known.has(x.url)),
			b.fetch.body,
			cfg,
		);
		excluded.push(...listing.excluded, ...read.excluded);
		for (const entry of read.entries) known.add(entry.url);
		fetched.push(
			...read.entries.map((entry) => ({
				...entry,
				feed: b.id,
				issuer: source.issuer,
				caution: source.caution,
			})),
		);
	}
	await fs.outputJson(
		path.join(ROOT, cfg.baseline.path),
		windowed([...stored, ...daily, ...fetched], cfg, now),
		{ spaces: 2 },
	);
	return excluded;
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
	const ownerFile = path.join(ROOT, cfg.owner_articles);
	const owned = fs.existsSync(ownerFile)
		? ((await fs.readJson(ownerFile)) as DiscoveredArticle[])
		: undefined;
	const { articles, excluded } = owned
		? { articles: owned, excluded: [] }
		: await discoverArticles(cfg, now);
	await fs.outputJson(
		path.join(runDir, "research", "discovery_excluded.json"),
		excluded,
		{ spaces: 2 },
	);
	const baselineExcluded = owned
		? []
		: await updateDiscoveryBaseline(cfg, now, articles);
	await fs.outputJson(
		path.join(runDir, "research", "discovery_excluded.json"),
		[...excluded, ...baselineExcluded],
		{ spaces: 2 },
	);
	if (articles.length === 0)
		throw new Error(
			"BYOSAN_ANGLE_STOP: no recent articles in registered sources",
		);
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
