import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
	fontconfigXml,
	fontMatchProblem,
	parseFcMatch,
	requiredFontFamilies,
} from "../src/domain/byosan/fonts.js";

const FONT_DIR = "/repo/assets/fonts";

describe("byosan fonts", () => {
	test("requires only the first family of each CSS stack once", () => {
		expect(
			requiredFontFamilies([
				"IBM Plex Sans JP, Noto Sans CJK JP, sans-serif",
				"Geist, IBM Plex Sans JP, Noto Sans CJK JP, sans-serif",
				"IBM Plex Sans JP",
			]),
		).toEqual(["IBM Plex Sans JP", "Geist"]);
	});

	test("writes a fontconfig file that registers the bundled font directory", () => {
		const xml = fontconfigXml(FONT_DIR);
		expect(xml).toContain("<dir>/repo/assets/fonts</dir>");
		expect(xml).toContain("/etc/fonts/fonts.conf");
	});

	test("accepts a match whose family is exact and whose file is bundled", () => {
		const match = parseFcMatch(
			`IBM Plex Sans JP\t${path.join(FONT_DIR, "IBMPlexSansJP-Regular.otf")}\n`,
		);
		expect(
			fontMatchProblem("IBM Plex Sans JP", match, FONT_DIR),
		).toBeUndefined();
	});

	test("rejects a substituted family instead of accepting the fallback", () => {
		const match = parseFcMatch(
			"DejaVu Sans\t/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf\n",
		);
		expect(fontMatchProblem("IBM Plex Sans JP", match, FONT_DIR)).toBe(
			"IBM Plex Sans JP -> DejaVu Sans",
		);
	});

	test("rejects a matching family that is not inside the bundled directory", () => {
		const match = parseFcMatch(
			"Geist\t/usr/share/fonts/opentype/Geist-Regular.otf\n",
		);
		expect(fontMatchProblem("Geist", match, FONT_DIR)).toBe(
			"Geist -> /usr/share/fonts/opentype/Geist-Regular.otf",
		);
	});

	test("reports an empty fc-match result as no match", () => {
		expect(fontMatchProblem("Geist", parseFcMatch(""), FONT_DIR)).toBe(
			"Geist -> (no match)",
		);
	});
});
