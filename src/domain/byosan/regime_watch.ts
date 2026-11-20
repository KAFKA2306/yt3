import { z } from "zod";

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
