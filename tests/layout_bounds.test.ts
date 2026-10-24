import { describe, expect, test } from "bun:test";
import { calculateBounds } from "../src/domain/layout/bounds.js";

const original = { width: 100, height: 200 };
const canvas = { width: 1000, height: 1000 };

describe("overlay bounds", () => {
	test("height_ratio scales height and keeps the source aspect ratio", () => {
		const bounds = calculateBounds(
			{
				type: "overlay",
				enabled: true,
				image_path: "x.png",
				height_ratio: 0.5,
			},
			original,
			canvas,
		);
		expect(bounds).toMatchObject({ width: 250, height: 500 });
	});

	test("bottom_right anchor places the overlay at the canvas corner minus offsets", () => {
		const bounds = calculateBounds(
			{
				type: "overlay",
				enabled: true,
				image_path: "x.png",
				height_ratio: 0.5,
				anchor: "bottom_right",
				offset: { right: 20, bottom: 10 },
			},
			original,
			canvas,
		);
		expect(bounds).toMatchObject({ x: 730, y: 490 });
	});
});
