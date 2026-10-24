import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import yaml from "js-yaml";

type DomainConfig = {
	prompts: {
		research: {
			consolidated_research: { system: string; user_template: string };
		};
	};
};

const config = yaml.load(
	fs.readFileSync("config/domains/byosan_money.yaml", "utf8"),
) as DomainConfig;

describe("byosan feed discovery prompt contract", () => {
	test("the research prompt injects no historical theme list", () => {
		expect(
			config.prompts.research.consolidated_research.user_template,
		).not.toContain("{recent_themes}");
	});

	test("candidates come only from the supplied new articles", () => {
		const { system, user_template } =
			config.prompts.research.consolidated_research;
		expect(user_template).toContain("[MISSION EVIDENCE]");
		expect(system).toContain("[MISSION EVIDENCE]");
		expect(system).not.toContain("最新の市場ニュース");
	});
});
