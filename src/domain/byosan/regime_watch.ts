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

export function buildRegimeFactSheet(
	evaluation: RegimeEvaluation,
	options?: {
		subject?: string;
		extraSourceDocs?: FactSheet["source_documents"];
	},
): FactSheet {
	const symbolDocs = evaluation.quotes.map((q) => ({
		url: `https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}/`,
		title: `${q.label} (${q.symbol}) Market Close ${q.trading_date}`,
		issuer: "Yahoo Finance Market Data",
		published: q.trading_date,
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

	return {
		schema_version: FACT_SHEET_SCHEMA_VERSION,
		company: "US Market & Semiconductor Regime Shift",
		subject:
			options?.subject ??
			`米国市場レジーム転換（${evaluation.trading_date}）：${evaluation.triggers.map((t) => t.label).join("・")}の急変が示す市場構造`,
		released: evaluation.trading_date,
		source_documents: [...symbolDocs, ...(options?.extraSourceDocs ?? [])],
		facts,
		unverified: [],
	};
}
