import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

describe("cron repair authority", () => {
	test("production cron cannot mutate the repository through background Gemini repair", () => {
		const source = fs.readFileSync(
			"src/io/utils/infra/run_workflow_cron.sh",
			"utf8",
		);
		expect(source).not.toContain("run_auto_heal");
		expect(source).not.toContain("/usr/local/bin/gemini");
		expect(source).not.toContain("Auto-Healing Initiated");
		expect(source).not.toContain("ENABLE_AUTO_HEAL");
		expect(source).toContain(
			"Repair is blocked until a repository change, regression evidence, and canonical validation exist.",
		);
	});
});
