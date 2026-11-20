import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import {
	buildRegimeFactSheet,
	evaluateRegimeSignals,
	type MarketQuote,
	parseRssItems,
	REGIME_CATALYST_FEEDS,
	REGIME_SYMBOLS,
	type RegimeCatalyst,
	scoreCatalystHeadlines,
	shouldTriggerRegimeVideo,
} from "../domain/byosan/regime_watch.js";
import { ROOT } from "../io/core.js";

type YahooChartResponse = {
	chart?: {
		result?: Array<{
			timestamp?: number[];
			indicators?: {
				quote?: Array<{ close?: Array<number | null> }>;
			};
		}>;
	};
};

async function fetchQuote(
	symbol: string,
	label: string,
): Promise<MarketQuote | null> {
	const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
	const res = await fetch(url, {
		headers: { "User-Agent": "yt3-byosan-regime-watch/1.0" },
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) return null;
	const data = (await res.json()) as YahooChartResponse;
	const series = data.chart?.result?.[0];
	const timestamps = series?.timestamp ?? [];
	const closes = series?.indicators?.quote?.[0]?.close ?? [];
	const pairs: Array<{ ts: number; close: number }> = [];
	for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
		const ts = timestamps[i];
		const close = closes[i];
		if (
			typeof ts === "number" &&
			typeof close === "number" &&
			Number.isFinite(close)
		) {
			pairs.push({ ts, close });
		}
	}
	if (pairs.length < 2) return null;
	const latest = pairs[pairs.length - 1];
	const prev = pairs[pairs.length - 2];
	if (!latest || !prev || prev.close === 0) return null;
	const changePct = ((latest.close - prev.close) / prev.close) * 100;
	const tradingDate = new Date(latest.ts * 1000).toISOString().slice(0, 10);
	return {
		symbol,
		label,
		trading_date: tradingDate,
		close: Number(latest.close.toFixed(2)),
		prev_close: Number(prev.close.toFixed(2)),
		change_pct: Number(changePct.toFixed(2)),
	};
}

async function fetchPrimaryCatalysts(): Promise<RegimeCatalyst[]> {
	const rawItems: Array<{
		title: string;
		url: string;
		issuer: string;
		published: string;
	}> = [];
	await Promise.all(
		REGIME_CATALYST_FEEDS.map(async (feed) => {
			try {
				const res = await fetch(feed.url, {
					headers: { "User-Agent": "yt3-byosan-regime-watch/1.0" },
					signal: AbortSignal.timeout(8_000),
				});
				if (!res.ok) return;
				const xml = await res.text();
				rawItems.push(...parseRssItems(xml, feed.issuer));
			} catch {
				// Non-fatal: individual feed outage must not block regime detection.
			}
		}),
	);
	return scoreCatalystHeadlines(rawItems, 8);
}

async function main() {
	const args = process.argv.slice(2);
	const trigger = args.includes("--trigger");
	const asJson = args.includes("--json");

	const quotes: MarketQuote[] = [];
	const fetchErrors: string[] = [];
	for (const item of REGIME_SYMBOLS) {
		try {
			const q = await fetchQuote(item.symbol, item.label);
			if (q) quotes.push(q);
			else fetchErrors.push(`${item.symbol}: insufficient quote data`);
		} catch (err) {
			fetchErrors.push(
				`${item.symbol}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	const evaluation = evaluateRegimeSignals(quotes);
	const catalysts =
		evaluation.regime !== "normal" ? await fetchPrimaryCatalysts() : [];
	const statePath = path.join(
		ROOT,
		"data",
		"state",
		"byosan",
		"regime_watch.json",
	);
	const prevState = fs.existsSync(statePath)
		? (fs.readJsonSync(statePath) as { last_triggered_date?: string | null })
		: { last_triggered_date: null };

	const willTrigger =
		trigger &&
		shouldTriggerRegimeVideo(evaluation, prevState.last_triggered_date ?? null);

	let triggerExitCode: number | null = null;
	let lastTriggeredDate = prevState.last_triggered_date ?? null;

	if (willTrigger) {
		const factSheetPath = path.join(
			ROOT,
			"data",
			"state",
			"byosan",
			`regime_fact_sheet_${evaluation.trading_date}.json`,
		);
		fs.ensureDirSync(path.dirname(factSheetPath));
		fs.writeJsonSync(
			factSheetPath,
			buildRegimeFactSheet(evaluation, { catalysts }),
			{
				spaces: 2,
			},
		);
		const tokyoDate = new Intl.DateTimeFormat("sv-SE", {
			timeZone: "Asia/Tokyo",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(new Date());
		const runId = `byosan_money/${tokyoDate}-daily-regime`;
		const prep = spawnSync(
			"task",
			["byosan:prepare", `DATE=${tokyoDate}`, `FACT_SHEET=${factSheetPath}`],
			{
				cwd: ROOT,
				env: { ...process.env, BYOSAN_SUFFIX: "-regime" },
				encoding: "utf8",
				timeout: 45 * 60 * 1000,
			},
		);
		if (prep.status === 0) {
			const pub = spawnSync(
				"task",
				["publish", "PROFILE=byosan", "--", runId],
				{
					cwd: ROOT,
					encoding: "utf8",
					timeout: 15 * 60 * 1000,
				},
			);
			triggerExitCode = pub.status ?? 1;
		} else {
			triggerExitCode = prep.status ?? 1;
		}
		if (triggerExitCode === 0) {
			lastTriggeredDate = evaluation.trading_date;
		}
	}

	const nextState = {
		checked_at: new Date().toISOString(),
		trading_date: evaluation.trading_date,
		regime: evaluation.regime,
		triggers: evaluation.triggers,
		quotes: evaluation.quotes,
		catalysts,
		fetch_errors: fetchErrors,
		triggered_now: willTrigger,
		trigger_exit_code: triggerExitCode,
		last_triggered_date: lastTriggeredDate,
	};
	fs.ensureDirSync(path.dirname(statePath));
	fs.writeJsonSync(statePath, nextState, { spaces: 2 });

	if (asJson) {
		console.log(JSON.stringify(nextState, null, 2));
	} else {
		console.log(
			`[byosan:regime-watch] date=${evaluation.trading_date} regime=${evaluation.regime} triggers=${evaluation.triggers.length} triggered_now=${willTrigger}`,
		);
		for (const q of evaluation.quotes) {
			const sign = q.change_pct >= 0 ? "+" : "";
			console.log(
				`  - ${q.label} (${q.symbol}): ${q.close} (${sign}${q.change_pct}%)`,
			);
		}
		for (const t of evaluation.triggers) {
			console.log(`  ! TRIGGER: ${t.reason}`);
		}
		for (const c of catalysts.slice(0, 4)) {
			console.log(`  * CATALYST [${c.issuer}] (score=${c.score}): ${c.title}`);
		}
	}
}

main();
