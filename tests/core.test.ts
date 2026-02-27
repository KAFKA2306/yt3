import { expect, test } from "bun:test";
import { loadConfig } from "../src/core.js";

test("config loads correctly", () => {
	const config = loadConfig();
	expect(config).toBeDefined();
	expect(config.workflow).toBeDefined();
});

test("environment check", () => {
	expect(process.env.GEMINI_API_KEY).toBeDefined();
});
