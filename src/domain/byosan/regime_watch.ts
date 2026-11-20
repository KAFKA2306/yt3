import { z } from "zod";
import { FACT_SHEET_SCHEMA_VERSION, type FactSheet } from "./fact_sheet.js";

export const MarketQuoteSchema = z.object({
	symbol: z.string(),
	label: z.string(),
	trading_date: z.string(),
	close: z.number(),
	prev_close: z.number(),
	change_pct: z.number(),
});

export type MarketQuote = z.infer<typeof MarketQuoteSchema>;

export type RegimeThresholdTrigger = {
	symbol: string;
	label: string;
	reason: string;
	value: number;
	change_pct: number;
};

export type RegimeEvaluation = {
	trading_date: string;
	regime: "normal" | "elevated" | "regime_shift";
	triggers: RegimeThresholdTrigger[];
	quotes: MarketQuote[];
};

export const REGIME_SYMBOLS = [
	{ symbol: "^GSPC", label: "S&P 500" },
	{ symbol: "^IXIC", label: "Nasdaq Composite" },
	{ symbol: "^SOX", label: "PHLX Semiconductor (SOX)" },
	{ symbol: "^VIX", label: "CBOE VIX" },
	{ symbol: "NKD=F", label: "Nikkei 225 Futures" },
] as const;

export function evaluateRegimeSignals(quotes: MarketQuote[]): RegimeEvaluation {
	const triggers: RegimeThresholdTrigger[] = [];
	const tradingDate =
		quotes
			.map((q) => q.trading_date)
			.sort()
			.reverse()[0] ?? new Date().toISOString().slice(0, 10);

	for (const q of quotes) {
		const absPct = Math.abs(q.change_pct);
		if (q.symbol === "^GSPC" && absPct >= 2.5) {
			triggers.push({
				symbol: q.symbol,
				label: q.label,
				reason: `S&P 500 daily move ${q.change_pct.toFixed(2)}% (>= 2.5%)`,
				value: q.close,
				change_pct: q.change_pct,
			});
		} else if (q.symbol === "^IXIC" && absPct >= 3.5) {
			triggers.push({
				symbol: q.symbol,
				label: q.label,
				reason: `Nasdaq daily move ${q.change_pct.toFixed(2)}% (>= 3.5%)`,
				value: q.close,
				change_pct: q.change_pct,
			});
		} else if (q.symbol === "^SOX" && absPct >= 5.0) {
			triggers.push({
				symbol: q.symbol,
				label: q.label,
				reason: `SOX daily move ${q.change_pct.toFixed(2)}% (>= 5.0%)`,
				value: q.close,
				change_pct: q.change_pct,
			});
		} else if (
			q.symbol === "^VIX" &&
			(q.close >= 25.0 || q.change_pct >= 20.0)
		) {
			triggers.push({
				symbol: q.symbol,
				label: q.label,
				reason: `VIX close ${q.close.toFixed(2)} (${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(1)}%)`,
				value: q.close,
				change_pct: q.change_pct,
			});
		} else if (q.symbol === "NKD=F" && absPct >= 3.0) {
			triggers.push({
				symbol: q.symbol,
				label: q.label,
				reason: `Nikkei Futures daily move ${q.change_pct.toFixed(2)}% (>= 3.0%)`,
				value: q.close,
				change_pct: q.change_pct,
			});
		}
	}

	const regime =
		triggers.length >= 2 ||
		triggers.some(
			(t) =>
				(t.symbol === "^SOX" && Math.abs(t.change_pct) >= 5.0) ||
				(t.symbol === "^GSPC" && Math.abs(t.change_pct) >= 2.5) ||
				(t.symbol === "^VIX" && t.value >= 28.0),
		)
			? "regime_shift"
			: triggers.length === 1
				? "elevated"
				: "normal";

	return {
		trading_date: tradingDate,
		regime,
		triggers,
		quotes,
	};
}

export function shouldTriggerRegimeVideo(
	evaluation: RegimeEvaluation,
	lastTriggeredDate: string | null,
): boolean {
	if (evaluation.regime !== "regime_shift") return false;
	return lastTriggeredDate !== evaluation.trading_date;
}

export type RegimeCatalyst = {
	title: string;
	url: string;
	issuer: string;
	published: string;
	matched_keywords: string[];
	score: number;
};

export const REGIME_CATALYST_FEEDS = [
	{
		issuer: "Yahoo Finance (Markets & SOX)",
		url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5ESOX,NVDA&region=US&lang=en-US",
	},
	{
		issuer: "CNBC Markets & Policy",
		url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
	},
	{
		issuer: "Federal Reserve",
		url: "https://www.federalreserve.gov/feeds/press_all.xml",
	},
	{
		issuer: "The White House",
		url: "https://www.whitehouse.gov/news/feed/",
	},
] as const;

const CATALYST_KEYWORDS: Array<{ term: string; weight: number }> = [
	{ term: "data center", weight: 4 },
	{ term: "datacenter", weight: 4 },
	{ term: "tremendous tax", weight: 5 },
	{ term: "tariff", weight: 4 },
	{ term: "tax", weight: 3 },
	{ term: "semiconductor", weight: 4 },
	{ term: "chip", weight: 3 },
	{ term: "export control", weight: 4 },
	{ term: "power grid", weight: 4 },
	{ term: "electricity", weight: 3 },
	{ term: "energy", weight: 2 },
	{ term: "regulation", weight: 3 },
	{ term: "antitrust", weight: 3 },
	{ term: "fed", weight: 3 },
	{ term: "federal reserve", weight: 4 },
	{ term: "rate", weight: 2 },
	{ term: "yield", weight: 3 },
	{ term: "treasury", weight: 3 },
	{ term: "capex", weight: 4 },
	{ term: "ai", weight: 2 },
	{ term: "nvidia", weight: 3 },
	{ term: "trump", weight: 3 },
	{ term: "congress", weight: 3 },
	{ term: "senate", weight: 3 },
	{ term: "china", weight: 3 },
	{ term: "selloff", weight: 3 },
	{ term: "plunge", weight: 3 },
	{ term: "vix", weight: 3 },
];

function decodeXmlEntities(text: string): string {
	return text
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

export function parseRssItems(
	xml: string,
	issuer: string,
): Array<{ title: string; url: string; issuer: string; published: string }> {
	const items: Array<{
		title: string;
		url: string;
		issuer: string;
		published: string;
	}> = [];
	const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
	for (const block of itemBlocks) {
		const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		const linkMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
		const pubMatch = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
		const title = titleMatch?.[1] ? decodeXmlEntities(titleMatch[1]) : "";
		const url = linkMatch?.[1] ? decodeXmlEntities(linkMatch[1]) : "";
		const rawDate = pubMatch?.[1] ? decodeXmlEntities(pubMatch[1]) : "";
		if (!title || !url?.startsWith("http")) continue;
		let published = new Date().toISOString().slice(0, 10);
		if (rawDate) {
			const parsed = Date.parse(rawDate);
			if (!Number.isNaN(parsed)) {
				published = new Date(parsed).toISOString().slice(0, 10);
			}
		}
		items.push({ title, url, issuer, published });
	}
	return items;
}

export function scoreCatalystHeadlines(
	items: Array<{
		title: string;
		url: string;
		issuer: string;
		published: string;
	}>,
	limit = 8,
): RegimeCatalyst[] {
	const seen = new Set<string>();
	const scored: RegimeCatalyst[] = [];
	for (const item of items) {
		const key = item.url.trim();
		if (seen.has(key)) continue;
		seen.add(key);
		const lower = item.title.toLowerCase();
		const matched: string[] = [];
		let score = 0;
		for (const kw of CATALYST_KEYWORDS) {
			const re = new RegExp(`\\b${kw.term.replace(/\s+/g, "\\s+")}\\b`, "i");
			if (re.test(lower)) {
				matched.push(kw.term);
				score += kw.weight;
			}
		}
		if (
			item.issuer === "The White House" ||
			item.issuer === "Federal Reserve"
		) {
			score += 2;
		}
		if (score >= 3) {
			scored.push({ ...item, matched_keywords: matched, score });
		}
	}
	return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function buildRegimeFactSheet(
	evaluation: RegimeEvaluation,
	options?: {
		subject?: string;
		catalysts?: RegimeCatalyst[];
		extraSourceDocs?: FactSheet["source_documents"];
	},
): FactSheet {
	const symbolDocs = evaluation.quotes.map((q) => ({
		url: `https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}/`,
		title: `${q.label} (${q.symbol}) Market Close ${q.trading_date}`,
		issuer: "Yahoo Finance Market Data",
		published: q.trading_date,
	}));
	const catalystDocs = (options?.catalysts ?? []).map((c) => ({
		url: c.url,
		title: c.title,
		issuer: c.issuer,
		published: c.published,
	}));
	const facts: FactSheet["facts"] = [];
	for (const q of evaluation.quotes) {
		const slug = q.symbol
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "");
		const sourceUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}/`;
		facts.push({
			id: `${slug}_close`,
			label: `${q.label} 終値`,
			value: q.close,
			unit: q.symbol === "^VIX" ? "pt" : "index",
			period: q.trading_date,
			basis: "actual",
			source_url: sourceUrl,
			status: "CONFIRMED",
			note: `前日終値 ${q.prev_close} から ${q.change_pct >= 0 ? "+" : ""}${q.change_pct}%`,
		});
		facts.push({
			id: `${slug}_change_pct`,
			label: `${q.label} 前日比騰落率`,
			value: q.change_pct,
			unit: "%",
			period: q.trading_date,
			basis: "actual",
			source_url: sourceUrl,
			status: "CONFIRMED",
		});
	}

	const topCatalystSummary =
		options?.catalysts && options.catalysts.length > 0
			? `（一次材料：${options.catalysts
					.slice(0, 2)
					.map((c) => c.title)
					.join(" / ")}）`
			: "";

	return {
		schema_version: FACT_SHEET_SCHEMA_VERSION,
		company: "US Market & Semiconductor Regime Shift",
		subject:
			options?.subject ??
			`米国市場レジーム転換（${evaluation.trading_date}）：${evaluation.triggers.map((t) => t.label).join("・")}の急変と政策・構造的ボトルネック${topCatalystSummary}`,
		released: evaluation.trading_date,
		source_documents: [
			...symbolDocs,
			...catalystDocs,
			...(options?.extraSourceDocs ?? []),
		],
		facts,
		unverified: [],
	};
}
