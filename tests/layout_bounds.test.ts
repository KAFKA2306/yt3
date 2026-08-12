import { describe, expect, test } from "bun:test";
import { calculateBounds } from "../src/domain/layout/bounds.ts";

describe("calculateBounds", () => {
	const original = { width: 100, height: 200 }; // 1:2 ratio
	const canvas = { width: 1000, height: 1000 };

	test("height_ratio scales height and maintains aspect ratio", () => {
		const config = {
			type: "overlay",
			enabled: true,
			image_path: "test.png",
			height_ratio: 0.5,
		};
		const bounds = calculateBounds(config, original, canvas);
		expect(bounds.height).toBe(500);
		expect(bounds.width).toBe(250); // 500 * (100 / 200)
	});

	test("width_ratio scales width and maintains aspect ratio", () => {
		const config = {
			type: "overlay",
			enabled: true,
			image_path: "test.png",
			width_ratio: 0.3,
		};
		const bounds = calculateBounds(config, original, canvas);
		expect(bounds.width).toBe(300);
		expect(bounds.height).toBe(600); // 300 * (200 / 100)
	});

	test("anchor bottom_left positions overlay at bottom-left corner with offset", () => {
		const config = {
			type: "overlay",
			enabled: true,
			image_path: "test.png",
			height_ratio: 0.5,
			anchor: "bottom_left",
			offset: { left: 20, bottom: 10 },
		};
		const bounds = calculateBounds(config, original, canvas);
		expect(bounds.x).toBe(20);
		expect(bounds.y).toBe(490); // 1000 - 500 (height) - 10 (bottom offset)
	});

	test("anchor bottom_right positions overlay at bottom-right corner with offset", () => {
		const config = {
			type: "overlay",
			enabled: true,
			image_path: "test.png",
			height_ratio: 0.5,
			anchor: "bottom_right",
			offset: { right: 20, bottom: 10 },
		};
		const bounds = calculateBounds(config, original, canvas);
		expect(bounds.x).toBe(730); // 1000 - 250 (width) - 20 (right offset)
		expect(bounds.y).toBe(490); // 1000 - 500 (height) - 10 (bottom offset)
	});

	test("preserves existing scaling = fit behavior when no anchor specified", () => {
		const config = {
			type: "overlay",
			enabled: true,
			image_path: "test.png",
			scaling: "fit" as const,
		};
		const bounds = calculateBounds(config, original, canvas);
		expect(bounds.width).toBe(500);
		expect(bounds.height).toBe(1000);
		expect(bounds.x).toBe(250); // Centered horizontally: (1000 - 500) / 2
		expect(bounds.y).toBe(0); // Centered vertically: (1000 - 1000) / 2
	});
});
