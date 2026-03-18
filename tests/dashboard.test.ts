import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import type { Express, Request, Response } from "express";

const PORT = 3001;
let app: Express;
let server: any;

beforeAll(() => {
	app = express();
	app.use(express.json());

	const authMiddleware = (req: Request, res: Response, next: Function) => {
		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		const token = authHeader.substring(7);
		if (token !== process.env.DASHBOARD_TOKEN) {
			return res.status(401).json({ error: "Unauthorized" });
		}
		next();
	};

	app.post("/api/chat", authMiddleware, (req: Request, res: Response) => {
		res.json({ success: true });
	});

	app.get("/api/chat/sse", authMiddleware, (req: Request, res: Response) => {
		res.json({ success: true });
	});

	app.get("/api/runs", authMiddleware, (req: Request, res: Response) => {
		res.json({ success: true });
	});

	server = app.listen(PORT);
	process.env.DASHBOARD_TOKEN = "test-token-123";
});

afterAll(() => {
	server.close();
});

describe("Dashboard API Authentication", () => {
	it("should return 401 for /api/chat without token", async () => {
		const res = await fetch(`http://localhost:${PORT}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: "test" }),
		});
		expect(res.status).toBe(401);
	});

	it("should return 401 for /api/chat with invalid token", async () => {
		const res = await fetch(`http://localhost:${PORT}/api/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer wrong-token",
			},
			body: JSON.stringify({ prompt: "test" }),
		});
		expect(res.status).toBe(401);
	});

	it("should allow /api/chat with valid token", async () => {
		const res = await fetch(`http://localhost:${PORT}/api/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token-123",
			},
			body: JSON.stringify({ prompt: "test" }),
		});
		expect(res.status).toBe(200);
	});

	it("should return 401 for /api/chat/sse without token", async () => {
		const res = await fetch(`http://localhost:${PORT}/api/chat/sse`);
		expect(res.status).toBe(401);
	});

	it("should allow /api/chat/sse with valid token", async () => {
		const res = await fetch(`http://localhost:${PORT}/api/chat/sse`, {
			headers: { Authorization: "Bearer test-token-123" },
		});
		expect(res.status).toBe(200);
	});

	it("should return 401 for /api/runs without token", async () => {
		const res = await fetch(`http://localhost:${PORT}/api/runs`);
		expect(res.status).toBe(401);
	});

	it("should allow /api/runs with valid token", async () => {
		const res = await fetch(`http://localhost:${PORT}/api/runs`, {
			headers: { Authorization: "Bearer test-token-123" },
		});
		expect(res.status).toBe(200);
	});
});
