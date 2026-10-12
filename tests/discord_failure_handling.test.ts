import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { handleNewsCommand } from "../src/agents/standalone/discord_bot.ts";
import {
	DISCORD_PERMANENT_FAILURE_EXIT_CODE,
	discordFailureExitCode,
	postDiscordWebhook,
} from "../src/io/utils/discord.ts";
import { AgentLogger } from "../src/io/utils/logger.ts";

const WEBHOOK_URL = "https://discord.example/webhook";
const messages = {
	starter: "Starting generation for: {query}",
	response: "Generating video for: {query}",
	threadPrefix: "video-",
	threadMessage: "Progress will be posted here.",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

function mockFetch(response: Response) {
	const fetchMock = mock(async () => response.clone());
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

function makeInteraction(query: string, deferError?: Error) {
	const calls: string[] = [];
	const thread = { send: async () => undefined };
	const starterMsg = { startThread: async () => thread };
	const channel = {
		send: async (content: string) => {
			calls.push(`channel:${content}`);
			return starterMsg;
		},
	};
	const interaction = {
		options: { getString: () => query },
		channel,
		deferReply: async () => {
			calls.push("defer");
			if (deferError) throw deferError;
		},
		editReply: async (content: string) => {
			calls.push(`reply:${content}`);
		},
	};
	return {
		interaction: interaction as unknown as ChatInputCommandInteraction,
		calls,
	};
}

describe("Discord login failure classification", () => {
	test("TokenInvalid login failure exits with the permanent code", () => {
		const error = Object.assign(new Error("An invalid token was provided."), {
			code: "TokenInvalid",
		});
		expect(discordFailureExitCode(error)).toBe(
			DISCORD_PERMANENT_FAILURE_EXIT_CODE,
		);
	});

	test("REST 401 exits with the permanent code", () => {
		const error = Object.assign(new Error("Unauthorized"), { status: 401 });
		expect(discordFailureExitCode(error)).toBe(
			DISCORD_PERMANENT_FAILURE_EXIT_CODE,
		);
	});

	test("gateway authentication failure (4004) exits with the permanent code", () => {
		expect(discordFailureExitCode(new Error("Authentication failed"))).toBe(
			DISCORD_PERMANENT_FAILURE_EXIT_CODE,
		);
	});

	test("gateway disallowed intents (4014) exits with the permanent code", () => {
		expect(discordFailureExitCode(new Error("Used disallowed intents"))).toBe(
			DISCORD_PERMANENT_FAILURE_EXIT_CODE,
		);
	});

	test("network failure stays transient and is not given the permanent code", () => {
		const error = new Error("getaddrinfo ENOTFOUND discord.com");
		expect(discordFailureExitCode(error)).toBe(1);
	});
});

describe("Discord webhook responses", () => {
	test("non-2xx webhook response is logged as a failure", async () => {
		const errorSpy = spyOn(AgentLogger, "error").mockImplementation(() => {});
		mockFetch(new Response("server error", { status: 500 }));

		await postDiscordWebhook(WEBHOOK_URL, { embeds: [] });

		expect(errorSpy).toHaveBeenCalledWith(
			"DISCORD",
			"ALERT",
			"HTTP_FAILED",
			"Discord webhook responded 500",
		);
	});

	test("429 is logged and suppresses later posts until Retry-After elapses", async () => {
		const warnSpy = spyOn(AgentLogger, "warn").mockImplementation(() => {});
		const fetchMock = mockFetch(
			new Response("rate limited", {
				status: 429,
				headers: { "retry-after": "60" },
			}),
		);

		await postDiscordWebhook(WEBHOOK_URL, { embeds: [] });
		await postDiscordWebhook(WEBHOOK_URL, { embeds: [] });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(
			"DISCORD",
			"ALERT",
			"RATE_LIMITED",
			"Discord webhook rate limited; retry after 60s",
		);
	});
});

describe("news command handler", () => {
	test("deferReply runs before any channel output and the valid query is launched", async () => {
		const { interaction, calls } = makeInteraction("AI news");
		const launched: string[] = [];

		await handleNewsCommand(interaction, messages, async (query) => {
			launched.push(query);
		});

		expect(calls[0]).toBe("defer");
		expect(calls[1]).toBe("channel:Starting generation for: AI news");
		expect(launched).toEqual(["AI news"]);
		expect(calls.at(-1)).toBe("reply:Generating video for: AI news");
	});

	test("deferReply failure stops the command before any channel output", async () => {
		const errorSpy = spyOn(AgentLogger, "error").mockImplementation(() => {});
		const { interaction, calls } = makeInteraction(
			"AI news",
			new Error("Unknown interaction"),
		);
		const launch = mock(async () => {});

		await handleNewsCommand(interaction, messages, launch);

		expect(calls.some((call) => call.startsWith("channel:"))).toBe(false);
		expect(launch).not.toHaveBeenCalled();
		expect(calls).not.toContain(
			"reply:Invalid query. Please use only letters, numbers, and basic punctuation.",
		);
		expect(errorSpy).toHaveBeenCalled();
	});

	test("invalid query gets the validation reply without starting a workflow", async () => {
		const { interaction, calls } = makeInteraction("rm -rf $HOME");
		const launch = mock(async () => {});

		await handleNewsCommand(interaction, messages, launch);

		expect(launch).not.toHaveBeenCalled();
		expect(calls).toEqual([
			"defer",
			"reply:Invalid query. Please use only letters, numbers, and basic punctuation.",
		]);
	});

	test("workflow launch failure is reported as an execution failure, not as an invalid query", async () => {
		spyOn(AgentLogger, "error").mockImplementation(() => {});
		const { interaction, calls } = makeInteraction("AI news");

		await handleNewsCommand(interaction, messages, async () => {
			throw new Error("spawn npx ENOENT");
		});

		expect(calls.at(-1)).toBe(
			"reply:Failed to start news generation. Check the bot log.",
		);
		expect(calls.some((call) => call.includes("Invalid query"))).toBe(false);
	});
});
