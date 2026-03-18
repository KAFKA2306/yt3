import { describe, it, expect } from "bun:test";
import { queryValidationSchema } from "../src/domain/validation";

describe("queryValidationSchema", () => {
	it("accepts valid queries", () => {
		const validQueries = [
			"bitcoin price",
			"AI news today",
			"Technology and Innovation",
			"Breaking Stock market update",
		];

		validQueries.forEach((query) => {
			const result = queryValidationSchema.safeParse(query);
			expect(result.success).toBe(true);
		});
	});

	it("rejects command injection attempts", () => {
		const maliciousQueries = [
			"; rm -rf /",
			"test && echo hacked",
			"query | cat /etc/passwd",
			"test` whoami `",
			"test$(whoami)",
		];

		maliciousQueries.forEach((query) => {
			const result = queryValidationSchema.safeParse(query);
			expect(result.success).toBe(false);
		});
	});

	it("rejects XSS attempts", () => {
		const xssQueries = ["<script>alert('xss')</script>", '"><script>alert("xss")</script>'];

		xssQueries.forEach((query) => {
			const result = queryValidationSchema.safeParse(query);
			expect(result.success).toBe(false);
		});
	});

	it("rejects queries longer than 200 characters", () => {
		const longQuery = "a".repeat(201);
		const result = queryValidationSchema.safeParse(longQuery);
		expect(result.success).toBe(false);
	});

	it("accepts queries up to 200 characters", () => {
		const validQuery = "a".repeat(200);
		const result = queryValidationSchema.safeParse(validQuery);
		expect(result.success).toBe(true);
	});

	it("rejects empty queries", () => {
		const result = queryValidationSchema.safeParse("");
		expect(result.success).toBe(false);
	});
});
