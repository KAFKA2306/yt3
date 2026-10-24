import { describe, expect, test } from "bun:test";
import {
	byosanFailureClassification,
	codexErrorDetail,
} from "../src/domain/byosan/codex_llm.js";
import { classifyByosanFailure } from "../src/scripts/byosan_daily.js";

const codexUsageLimitMessage = [
	'BYOSAN_PREFLIGHT_BLOCKED: FAIL /home/kafka/2511youtuber/v3/yt3/runs/byosan_money/2026-10-23-daily/audit/preflight.json codex_exec FAIL: codex exec structured-output probe failed: CODEX_EXEC_FAILED stage=byosan_production_preflight status=1  /.well-known/oauth-protected-resource"" })',
	"ERROR: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 11:10 PM.",
	"ERROR: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 11:10 PM.",
].join("\n");

const mcpNoiseOnly =
	'rmcp::transport::worker: Auth required: AuthRequired { www_authenticate_header: "Bearer" } /.well-known/oauth-protected-resource';

const geminiQuotaMessage =
	"BYOSAN_PREFLIGHT_BLOCKED: FAIL gemini FAIL: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. quotaMetric: generativelanguage.googleapis.com/generate_content_free_tier_requests";

describe("Byosan failure classification", () => {
	test("classifies today's codex usage-limit message as PROVIDER_RATE_LIMIT", () => {
		expect(classifyByosanFailure(codexUsageLimitMessage)).toMatchObject({
			failureClass: "PROVIDER_RATE_LIMIT",
			retryPolicy: "TRANSIENT_BOUNDED",
			maxRetries: byosanFailureClassification().transient_max_retries,
		});
	});

	test.each([
		"CODEX_EXEC_FAILED stage=byosan_production_preflight status=1 401 Unauthorized",
		"CODEX_EXEC_FAILED stage=byosan_production_preflight status=1 403 Forbidden",
		"CODEX_EXEC_FAILED stage=byosan_production_preflight status=1 invalid_grant: refresh token was revoked",
		"CODEX_EXEC_FAILED stage=byosan_production_preflight status=1 ERROR: not logged in, run codex login",
	])("keeps a real authentication error as NETWORK_AUTH: %s", (message) => {
		expect(classifyByosanFailure(message).failureClass).toBe("NETWORK_AUTH");
	});

	test("classifies a Gemini 429 quota error as PROVIDER_RATE_LIMIT", () => {
		expect(classifyByosanFailure(geminiQuotaMessage).failureClass).toBe(
			"PROVIDER_RATE_LIMIT",
		);
	});

	test("classifies an MCP-noise-only message as UNCLASSIFIED", () => {
		expect(classifyByosanFailure(mcpNoiseOnly).failureClass).toBe(
			"UNCLASSIFIED",
		);
	});

	test("keeps the ERROR line first and drops MCP noise from codex stderr", () => {
		const detail = codexErrorDetail(
			`${mcpNoiseOnly}\nERROR: You’ve hit your usage limit. try again at 11:10 PM.\n`,
			byosanFailureClassification(),
		);
		expect(detail).toBe(
			"ERROR: You’ve hit your usage limit. try again at 11:10 PM.\n",
		);
	});
});
