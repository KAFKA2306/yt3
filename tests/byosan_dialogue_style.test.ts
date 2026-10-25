import { describe, expect, test } from "bun:test";
import {
	loadDialogueStyle,
	renderDialogueStylePrompt,
} from "../src/domain/byosan/dialogue_style.js";

describe("byosan dialogue style guidance", () => {
	test("the configured guidance renders as a bulleted prompt section", () => {
		const style = loadDialogueStyle();
		const lines = renderDialogueStylePrompt(style).split("\n");
		expect(lines[0]).toBe(style.prompt_heading);
		expect(lines.length).toBe(style.guidance.length + 1);
	});
});
