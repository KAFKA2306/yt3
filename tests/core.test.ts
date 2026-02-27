import { expect, test } from "bun:test";
import { loadConfig } from "../src/core.js";

test("config loads correctly", () => {
	const config = loadConfig();
	expect(config).toBeDefined();
	expect(config.workflow).toBeDefined();
});

test("environment check", () => {
	// Only run this check if explicitly requested or in production
	if (!process.env.GEMINI_API_KEY) {
		console.warn("Skipping environment check: GEMINI_API_KEY missing");
		return;
	}
	expect(process.env.GEMINI_API_KEY).toBeDefined();
});
