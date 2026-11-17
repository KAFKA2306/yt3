import { describe, expect, test } from "bun:test";
import {
	getByosanVisualSystem,
	getKafkaVisualSystem,
} from "../src/domain/design/kafka_visual_system.js";
import {
	loadDesignTokens,
	resolveToken,
} from "../src/scripts/sync_video_design.js";

const SIGNAL = {
	primary: "#7BA7E1",
	secondary: "#B8A7E6",
	accent: "#F7B7C1",
	success: "#A8D5BA",
	warning: "#FFD8A8",
	neutral: "#8FA1B3",
};

describe("KAFKA SIGNAL Design System is the standard", () => {
	test("the token source holds the six KAFKA SIGNAL colors", () => {
		const tokens = loadDesignTokens();
		for (const [name, hex] of Object.entries(SIGNAL))
			expect(resolveToken(tokens, `color.light.${name}`)).toBe(hex);
	});

	test("the shared and byosan design systems use the KAFKA SIGNAL colors", () => {
		for (const design of [getKafkaVisualSystem(), getByosanVisualSystem()]) {
			expect(design.colors.brand_accent).toBe(SIGNAL.primary);
			expect(design.colors.accent_secondary).toBe(SIGNAL.secondary);
			expect(design.colors.accent_primary).toBe(SIGNAL.accent);
			expect(design.colors.success).toBe(SIGNAL.success);
			expect(design.colors.warning).toBe(SIGNAL.warning);
		}
	});
});
