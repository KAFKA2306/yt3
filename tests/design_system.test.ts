import { describe, expect, test } from "bun:test";
import {
	assertDesignSystemGeometry,
	getKafkaVisualSystem,
	validateDesignSystem,
} from "../src/domain/design/kafka_visual_system.js";

describe("Kafka Visual Design System v1", () => {
	test("loads the canonical surfaces and validates geometry invariants", () => {
		const design = getKafkaVisualSystem();

		expect(design.canvas.landscape).toEqual({
			width: 1920,
			height: 1080,
			fps: 30,
		});
		expect(design.canvas.shorts).toEqual({
			width: 1080,
			height: 1920,
			fps: 30,
		});
		expect(design.canvas.thumbnail).toEqual({ width: 1280, height: 720 });
		expect(design.colors.background).toBe("#0D1E38");
		expect(() => assertDesignSystemGeometry(design)).not.toThrow();
	});

	test("rejects malformed visual tokens", () => {
		const design = getKafkaVisualSystem();
		const invalid = structuredClone(design);
		invalid.colors.background = "navy";

		expect(() => validateDesignSystem(invalid)).toThrow(/RRGGBB|color/i);
	});
});
