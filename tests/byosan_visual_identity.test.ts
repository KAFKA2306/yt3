import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import yaml from "js-yaml";
import { resolveByosanVisualIdentity } from "../src/domain/byosan/visual_identity.js";

describe("byosan visual identity", () => {
	test("derives the production palette from the light design tokens", () => {
		const config = yaml.load(
			fs.readFileSync("config/domains/byosan_money.yaml", "utf8"),
		);
		const palette = resolveByosanVisualIdentity(config);
		expect(palette.background).toBe("#F7F5EF");
		expect(palette.textPrimary).toBe("#17233F");
		expect(palette.brandAccent).toBe("#2563EB");
		expect(palette.primaryAccent).toBe("#7DD3FC");
		expect(palette.secondaryAccent).toBe("#17233F");
	});

	test("keeps amber-family color reserved for warning semantics", () => {
		const config = yaml.load(
			fs.readFileSync("config/domains/byosan_money.yaml", "utf8"),
		);
		const palette = resolveByosanVisualIdentity(config);
		expect(palette.warning).toBe("#A16207");
		expect(palette.primaryAccent).not.toBe(palette.warning);
		expect(palette.secondaryAccent).not.toBe(palette.warning);
	});
});
