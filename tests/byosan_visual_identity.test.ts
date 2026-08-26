import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import yaml from "js-yaml";
import {
	mixHex,
	resolveByosanVisualIdentity,
} from "../src/domain/byosan/visual_identity.js";

describe("byosan visual identity", () => {
	test("derives the production palette from canonical design tokens", () => {
		const config = yaml.load(
			fs.readFileSync("config/domains/byosan_money.yaml", "utf8"),
		);
		const palette = resolveByosanVisualIdentity(config);
		expect(palette.primaryAccent).toBe("#7DC8F7");
		expect(palette.textPrimary).toBe("#FFFDF8");
		expect(palette.secondaryAccent).toBe(
			mixHex("#BFE7FF", "#FF9FB2", 0.35),
		);
		expect(palette.secondaryAccent).not.toBe("#FFB547");
		expect(palette.background).not.toBe("#07111F");
	});

	test("keeps amber-family color reserved for warning semantics", () => {
		const config = yaml.load(
			fs.readFileSync("config/domains/byosan_money.yaml", "utf8"),
		);
		const palette = resolveByosanVisualIdentity(config);
		expect(palette.warning).toBe("#FFB86B");
		expect(palette.primaryAccent).not.toBe(palette.warning);
		expect(palette.secondaryAccent).not.toBe(palette.warning);
	});
});
