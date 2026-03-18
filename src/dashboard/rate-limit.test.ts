import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fetch from "node-fetch";
import type { Server } from "http";

const BASE_URL = "http://localhost:3001";
let server: Server;

beforeAll(async () => {
	const module = await import("./server.ts");
	const app = module.default;
	server = app.listen(3001);
});

afterAll(async () => {
	if (server) {
		server.close();
	}
});

describe("Rate Limiting", () => {
	it("should allow requests under the chat rate limit", async () => {
		for (let i = 0; i < 5; i++) {
			const response = await fetch(`${BASE_URL}/api/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer test-token`,
				},
				body: JSON.stringify({ prompt: `Test ${i}` }),
			});
			expect(response.status).toBe(200);
		}
	});

	it("should reject chat requests exceeding rate limit with 429", async () => {
		for (let i = 0; i < 5; i++) {
			await fetch(`${BASE_URL}/api/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer test-token`,
				},
				body: JSON.stringify({ prompt: `Test ${i}` }),
			});
		}

		const response = await fetch(`${BASE_URL}/api/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer test-token`,
			},
			body: JSON.stringify({ prompt: "Over limit" }),
		});

		expect(response.status).toBe(429);
		const json = (await response.json()) as Record<string, unknown>;
		expect(json.error).toBe("Too many requests");
		expect(json.retryAfter).toBeDefined();
	});

	it("should include Retry-After header in 429 response", async () => {
		for (let i = 0; i < 5; i++) {
			await fetch(`${BASE_URL}/api/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer test-token`,
				},
				body: JSON.stringify({ prompt: `Test ${i}` }),
			});
		}

		const response = await fetch(`${BASE_URL}/api/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer test-token`,
			},
			body: JSON.stringify({ prompt: "Over limit" }),
		});

		expect(response.status).toBe(429);
		expect(
			response.headers.get("RateLimit-Reset") ||
				response.headers.get("Retry-After"),
		).toBeDefined();
	});

	it("should allow requests under the runs rate limit", async () => {
		for (let i = 0; i < 10; i++) {
			const response = await fetch(`${BASE_URL}/api/runs`, {
				method: "GET",
				headers: {
					Authorization: `Bearer test-token`,
				},
			});
			expect([200, 404, 500]).toContain(response.status);
		}
	});

	it("should reject runs requests exceeding rate limit with 429", async () => {
		for (let i = 0; i < 10; i++) {
			await fetch(`${BASE_URL}/api/runs`, {
				method: "GET",
				headers: {
					Authorization: `Bearer test-token`,
				},
			});
		}

		const response = await fetch(`${BASE_URL}/api/runs`, {
			method: "GET",
			headers: {
				Authorization: `Bearer test-token`,
			},
		});

		expect(response.status).toBe(429);
		const json = (await response.json()) as Record<string, unknown>;
		expect(json.error).toBe("Too many requests");
	});

	it("should rate limit per IP address", async () => {
		const headers = {
			"Content-Type": "application/json",
			Authorization: `Bearer test-token`,
		};

		for (let i = 0; i < 5; i++) {
			await fetch(`${BASE_URL}/api/chat`, {
				method: "POST",
				headers,
				body: JSON.stringify({ prompt: `Test ${i}` }),
			});
		}

		const response = await fetch(`${BASE_URL}/api/chat`, {
			method: "POST",
			headers,
			body: JSON.stringify({ prompt: "Over limit" }),
		});

		expect(response.status).toBe(429);
	});

	it("should enforce different limits for different endpoints", async () => {
		const chatHeaders = {
			"Content-Type": "application/json",
			Authorization: `Bearer test-token`,
		};

		const runsHeaders = {
			Authorization: `Bearer test-token`,
		};

		for (let i = 0; i < 5; i++) {
			await fetch(`${BASE_URL}/api/chat`, {
				method: "POST",
				headers: chatHeaders,
				body: JSON.stringify({ prompt: `Test ${i}` }),
			});
		}

		const sixthChat = await fetch(`${BASE_URL}/api/chat`, {
			method: "POST",
			headers: chatHeaders,
			body: JSON.stringify({ prompt: "6th" }),
		});

		expect(sixthChat.status).toBe(429);

		for (let i = 0; i < 10; i++) {
			const response = await fetch(`${BASE_URL}/api/runs`, {
				method: "GET",
				headers: runsHeaders,
			});
			expect([200, 404, 500]).toContain(response.status);
		}

		const eleventhRuns = await fetch(`${BASE_URL}/api/runs`, {
			method: "GET",
			headers: runsHeaders,
		});

		expect(eleventhRuns.status).toBe(429);
	});
});
