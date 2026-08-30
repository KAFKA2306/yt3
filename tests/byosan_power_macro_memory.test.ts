import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	appendByosanPowerMacroWeek,
	composeResearchMemoryContext,
	getByosanPowerMacroHistoryPath,
	loadByosanPowerMacroContext,
} from "../src/domain/byosan/power_macro_memory.js";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

async function copyHistoryToTemp(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "byosan-macro-memory-"));
	tempRoots.push(root);
	const destination = getByosanPowerMacroHistoryPath(root);
	await fs.ensureDir(path.dirname(destination));
	await fs.copy(
		getByosanPowerMacroHistoryPath(process.cwd()),
		destination,
	);
	return root;
}

describe("Byosan Power Macro runtime memory", () => {
	test("projects five persistent theses and only the latest three weeks", () => {
		const context = loadByosanPowerMacroContext(process.cwd());
		expect(context.match(/【Thesis /g)?.length).toBe(5);
		expect(context.match(/【Week /g)?.length).toBe(3);
		expect(context).toContain("【Week 2026-07-04】");
		expect(context).toContain("【Week 2026-06-27】");
		expect(context).toContain("【Week 2026-06-20】");
		expect(context).not.toContain("【Week 2026-06-13】");
		expect(context).toContain("us_equity_eps_base");
		expect(context).toContain("do not treat them as current facts");
	});

	test("adds long-term memory only to the byosan_money research context", () => {
		const recent = "RECENT MEMORY";
		const byosan = composeResearchMemoryContext(
			"byosan_money",
			recent,
			process.cwd(),
		);
		expect(byosan).toContain("[BYOSAN POWER MACRO LONG-TERM MEMORY]");
		expect(byosan).toContain(recent);
		expect(
			composeResearchMemoryContext("humanity_observatory", recent, process.cwd()),
		).toBe(recent);
	});

	test("rejects a duplicate week_end", async () => {
		const root = await copyHistoryToTemp();
		expect(() =>
			appendByosanPowerMacroWeek(
				{
					week_end: "2026-07-04",
					regime: "duplicate",
					new_insights: ["duplicate"],
					thesis_update: "duplicate",
					counterevidence: "duplicate",
					source_report:
						"https://github.com/KAFKA2306/prompt-vault/blob/main/docs/reports/weekly-power-macro-intelligence/2026-07-04.md",
				},
				root,
			),
		).toThrow("BYOSAN_POWER_MACRO_DUPLICATE_WEEK");
	});

	test("appends one future week and updates period_end", async () => {
		const root = await copyHistoryToTemp();
		appendByosanPowerMacroWeek(
			{
				week_end: "2026-07-11",
				regime: "test regime",
				new_insights: ["test insight"],
				thesis_update: "test thesis update",
				counterevidence: "test counterevidence",
				source_report:
					"https://github.com/KAFKA2306/prompt-vault/blob/main/docs/reports/weekly-power-macro-intelligence/2026-07-11.md",
			},
			root,
		);
		const updated = (await fs.readJson(getByosanPowerMacroHistoryPath(root))) as {
			weeks: Array<{ week_end: string }>;
			derived_from: { period_end: string };
		};
		expect(updated.weeks).toHaveLength(15);
		expect(updated.weeks.at(-1)?.week_end).toBe("2026-07-11");
		expect(updated.derived_from.period_end).toBe("2026-07-11");
	});
});
