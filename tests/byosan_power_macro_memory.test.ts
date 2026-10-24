import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	appendByosanPowerMacroWeek,
	getByosanPowerMacroHistoryPath,
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
	await fs.copy(getByosanPowerMacroHistoryPath(process.cwd()), destination);
	return root;
}

describe("Byosan Power Macro runtime memory", () => {
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
});
