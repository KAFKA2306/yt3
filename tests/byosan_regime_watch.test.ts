import { describe, expect, it } from "bun:test";
import { parseFactSheet } from "../src/domain/byosan/fact_sheet.js";
import {
	buildRegimeFactSheet,
	evaluateRegimeSignals,
	type MarketQuote,
	shouldTriggerRegimeVideo,
} from "../src/domain/byosan/regime_watch.js";

describe("Byosan 0-token market regime watch", () => {
	it("stays normal on a calm market session (0 triggers)", () => {
		const quotes: MarketQuote[] = [
			{
				symbol: "^GSPC",
				label: "S&P 500",
				trading_date: "2026-11-20",
				close: 7100,
				prev_close: 7080,
				change_pct: 0.28,
			},
			{
				symbol: "^SOX",
				label: "SOX",
				trading_date: "2026-11-20",
				close: 9400,
				prev_close: 9350,
				change_pct: 0.53,
			},
			{
				symbol: "^VIX",
				label: "VIX",
				trading_date: "2026-11-20",
				close: 16.2,
				prev_close: 16.0,
				change_pct: 1.25,
			},
		];
		const ev = evaluateRegimeSignals(quotes);
		expect(ev.regime).toBe("normal");
		expect(ev.triggers.length).toBe(0);
		expect(shouldTriggerRegimeVideo(ev, null)).toBe(false);
	});

	it("detects regime_shift on major semiconductor/index selloff + VIX spike and deduplicates by trading_date", () => {
		const quotes: MarketQuote[] = [
			{
				symbol: "^GSPC",
				label: "S&P 500",
				trading_date: "2026-11-20",
				close: 6910.39,
				prev_close: 7175.8,
				change_pct: -3.7,
			},
			{
				symbol: "^IXIC",
				label: "Nasdaq Composite",
				trading_date: "2026-11-20",
				close: 22617.73,
				prev_close: 23878.5,
				change_pct: -5.28,
			},
			{
				symbol: "^SOX",
				label: "SOX",
				trading_date: "2026-11-20",
				close: 8408.59,
				prev_close: 9419.3,
				change_pct: -10.73,
			},
			{
				symbol: "^VIX",
				label: "VIX",
				trading_date: "2026-11-20",
				close: 35.89,
				prev_close: 28.44,
				change_pct: 26.2,
			},
		];
		const ev = evaluateRegimeSignals(quotes);
		expect(ev.regime).toBe("regime_shift");
		expect(ev.triggers.length).toBe(4);
		expect(shouldTriggerRegimeVideo(ev, null)).toBe(true);
		// Same trading date already triggered -> must not duplicate
		expect(shouldTriggerRegimeVideo(ev, "2026-11-20")).toBe(false);

		const sheet = buildRegimeFactSheet(ev);
		expect(() => parseFactSheet(sheet)).not.toThrow();
		expect(sheet.facts.length).toBe(8);
	});
});
