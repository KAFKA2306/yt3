import { describe, expect, test } from "bun:test";
import {
	DISCORD_PERMANENT_FAILURE_EXIT_CODE,
	DISCORD_TRANSIENT_FAILURE_EXIT_CODE,
	discordFailureExitCode,
} from "../src/io/utils/discord.js";

describe("Discord bot failure exit codes", () => {
	test("authentication and intent failures exit with the permanent code", () => {
		expect(discordFailureExitCode({ code: "TokenInvalid" })).toBe(
			DISCORD_PERMANENT_FAILURE_EXIT_CODE,
		);
		expect(discordFailureExitCode({ status: 401 })).toBe(
			DISCORD_PERMANENT_FAILURE_EXIT_CODE,
		);
		expect(discordFailureExitCode({ message: "Authentication failed" })).toBe(
			DISCORD_PERMANENT_FAILURE_EXIT_CODE,
		);
		expect(discordFailureExitCode({ message: "Used disallowed intents" })).toBe(
			DISCORD_PERMANENT_FAILURE_EXIT_CODE,
		);
	});

	test("network failures stay transient", () => {
		expect(
			discordFailureExitCode(new Error("getaddrinfo ENOTFOUND discord.com")),
		).toBe(DISCORD_TRANSIENT_FAILURE_EXIT_CODE);
	});
});
