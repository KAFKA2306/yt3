import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { validateCredentials } from "../src/domain/validation";

describe("validateCredentials", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("throws error when YouTube is enabled but credentials are missing", () => {
		delete process.env.YOUTUBE_CLIENT_ID;
		delete process.env.YOUTUBE_CLIENT_SECRET;

		expect(() => {
			validateCredentials({ youtube: true });
		}).toThrow();
	});

	it("throws error when Twitter is enabled but credentials are missing", () => {
		delete process.env.X_API_KEY;
		delete process.env.TWITTER_API_KEY;
		delete process.env.X_API_SECRET;
		delete process.env.TWITTER_API_SECRET;

		expect(() => {
			validateCredentials({ twitter: true });
		}).toThrow();
	});

	it("succeeds when YouTube credentials are provided", () => {
		process.env.YOUTUBE_CLIENT_ID = "test-client-id";
		process.env.YOUTUBE_CLIENT_SECRET = "test-client-secret";

		expect(() => {
			validateCredentials({ youtube: true });
		}).not.toThrow();
	});

	it("succeeds when Twitter credentials are provided", () => {
		process.env.X_API_KEY = "test-api-key";
		process.env.X_API_SECRET = "test-api-secret";
		process.env.X_ACCESS_TOKEN = "test-access-token";
		process.env.X_ACCESS_SECRET = "test-access-secret";

		expect(() => {
			validateCredentials({ twitter: true });
		}).not.toThrow();
	});

	it("does not validate credentials when providers are disabled", () => {
		delete process.env.YOUTUBE_CLIENT_ID;
		delete process.env.X_API_KEY;

		expect(() => {
			validateCredentials({});
		}).not.toThrow();
	});
});
