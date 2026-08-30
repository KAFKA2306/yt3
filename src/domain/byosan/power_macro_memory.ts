import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../../io/core.js";

export interface PowerMacroWeek {
	week_end: string;
	regime: string;
	new_insights: string[];
	thesis_update: string;
	counterevidence: string;
	source_report: string;
}

interface PersistentThesis {
	id: string;
	statement: string;
	status: string;
}

interface PowerMacroHistory {
	schema_version: number;
	domain: string;
	kind: string;
	derived_from: {
		repository: string;
		report_series: string;
		period_start: string;
		period_end: string;
		note?: string;
	};
	weeks: PowerMacroWeek[];
	persistent_theses: PersistentThesis[];
}

export function getByosanPowerMacroHistoryPath(root = ROOT): string {
	return path.join(
		root,
		"data",
		"memory",
		"byosan_money",
		"power_macro_history.json",
	);
}

function assertWeek(week: PowerMacroWeek): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(week.week_end)) {
		throw new Error(`BYOSAN_POWER_MACRO_INVALID_WEEK_END: ${week.week_end}`);
	}
	for (const [key, value] of Object.entries({
		regime: week.regime,
		thesis_update: week.thesis_update,
		counterevidence: week.counterevidence,
		source_report: week.source_report,
	})) {
		if (typeof value !== "string" || value.trim().length === 0) {
			throw new Error(`BYOSAN_POWER_MACRO_INVALID_${key.toUpperCase()}`);
		}
	}
	if (!Array.isArray(week.new_insights) || week.new_insights.length === 0) {
		throw new Error("BYOSAN_POWER_MACRO_INVALID_NEW_INSIGHTS");
	}
	if (!week.source_report.startsWith("https://github.com/KAFKA2306/prompt-vault/")) {
		throw new Error("BYOSAN_POWER_MACRO_INVALID_SOURCE_REPORT");
	}
}

function readHistory(root = ROOT): PowerMacroHistory {
	const file = getByosanPowerMacroHistoryPath(root);
	if (!fs.existsSync(file)) {
		throw new Error(`BYOSAN_POWER_MACRO_HISTORY_MISSING: ${file}`);
	}
	const history = fs.readJsonSync(file) as PowerMacroHistory;
	if (
		history.schema_version !== 1 ||
		history.domain !== "byosan_money" ||
		history.kind !== "power_macro_weekly_history" ||
		!Array.isArray(history.weeks) ||
		!Array.isArray(history.persistent_theses)
	) {
		throw new Error("BYOSAN_POWER_MACRO_HISTORY_INVALID_SCHEMA");
	}
	const seen = new Set<string>();
	for (const week of history.weeks) {
		assertWeek(week);
		if (seen.has(week.week_end)) {
			throw new Error(`BYOSAN_POWER_MACRO_DUPLICATE_WEEK: ${week.week_end}`);
		}
		seen.add(week.week_end);
	}
	for (const thesis of history.persistent_theses) {
		if (!thesis.id || !thesis.statement || !thesis.status) {
			throw new Error("BYOSAN_POWER_MACRO_INVALID_PERSISTENT_THESIS");
		}
	}
	return history;
}

export function loadByosanPowerMacroContext(root = ROOT): string {
	const history = readHistory(root);
	const thesisText = history.persistent_theses
		.map(
			(thesis) =>
				`【Thesis ${thesis.id} / ${thesis.status}】\n${thesis.statement}`,
		)
		.join("\n\n");
	const recentWeekText = history.weeks
		.slice(-3)
		.reverse()
		.map(
			(week) =>
				`【Week ${week.week_end}】\nRegime: ${week.regime}\nThesis update: ${week.thesis_update}\nCounterevidence: ${week.counterevidence}\nProvenance: ${week.source_report}`,
		)
		.join("\n\n");
	return [
		"[BYOSAN POWER MACRO LONG-TERM MEMORY]",
		"Historical theses only. Use them to formulate questions and counterfactuals; do not treat them as current facts. Re-verify current claims with the approved source registry.",
		thesisText,
		recentWeekText,
	]
		.filter(Boolean)
		.join("\n\n");
}

export function composeResearchMemoryContext(
	bucket: string,
	recentContext: string,
	root = ROOT,
): string {
	if (bucket !== "byosan_money") return recentContext;
	return [loadByosanPowerMacroContext(root), recentContext]
		.filter(Boolean)
		.join("\n\n");
}

export function appendByosanPowerMacroWeek(
	week: PowerMacroWeek,
	root = ROOT,
): void {
	assertWeek(week);
	const history = readHistory(root);
	if (history.weeks.some((existing) => existing.week_end === week.week_end)) {
		throw new Error(`BYOSAN_POWER_MACRO_DUPLICATE_WEEK: ${week.week_end}`);
	}
	const latest = history.weeks.at(-1)?.week_end;
	if (latest && week.week_end <= latest) {
		throw new Error(
			`BYOSAN_POWER_MACRO_NOT_APPEND_ONLY: latest=${latest} incoming=${week.week_end}`,
		);
	}
	history.weeks.push(week);
	history.derived_from.period_end = week.week_end;
	fs.writeJsonSync(getByosanPowerMacroHistoryPath(root), history, { spaces: 2 });
}
