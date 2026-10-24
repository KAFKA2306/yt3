import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "fs-extra";
import { getKafkaVisualSystem } from "../src/domain/design/kafka_visual_system.js";

describe("humanity shared design is pinned to HEAD", () => {
	test("getKafkaVisualSystem reads the unchanged shared design file", () => {
		const head = fs.readJsonSync(
			"tests/fixtures/design/kafka_visual_system_v1.head.json",
		);
		expect(getKafkaVisualSystem()).toEqual(head);
	});

	test("shared design file bytes equal the pinned HEAD fixture", () => {
		expect(
			createHash("sha256")
				.update(fs.readFileSync("config/design/kafka_visual_system_v1.json"))
				.digest("hex"),
		).toBe(
			createHash("sha256")
				.update(
					fs.readFileSync(
						"tests/fixtures/design/kafka_visual_system_v1.head.json",
					),
				)
				.digest("hex"),
		);
	});
});
