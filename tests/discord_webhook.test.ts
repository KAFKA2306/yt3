import { afterAll, describe, expect, test } from "bun:test";
import { postDiscordWebhook } from "../src/io/utils/discord.js";

const server = Bun.serve({
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		if (request.method === "POST" && url.searchParams.get("wait") === "true")
			return Response.json({ id: "123" });
		if (request.method === "GET" && url.pathname.endsWith("/messages/123"))
			return Response.json({ id: "123" });
		return new Response("missing", { status: 404 });
	},
});

afterAll(() => server.stop());

describe("discord webhook delivery", () => {
	test("returns the message id after reading the message back", async () => {
		const id = await postDiscordWebhook(
			`http://localhost:${server.port}/api/webhooks/1/token`,
			{ content: "x" },
		);
		expect(id).toBe("123");
	});
});
