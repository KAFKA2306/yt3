import { describe, expect, test } from "bun:test";
import {
	type ByosanActiveProbeEvidence,
	auditByosanActiveProbeEvidence,
	summarizeTextDiff,
	tokenizerFingerprint,
} from "../src/domain/byosan/active_probe.js";

function evidence(
	overrides: Partial<ByosanActiveProbeEvidence> = {},
): ByosanActiveProbeEvidence {
	return {
		id: "probe_1",
		probeType: "git_diff",
		status: "VERIFIED",
		target: "/tmp/repo:a..b",
		executedAt: "2026-09-06T10:00:00.000Z",
		requestOrInputFingerprint: "12345678abcdef",
		observedResult: "spec changed from 500k to 1m",
		reproducibility: "git diff a b --",
		sourceIds: ["source_1"],
		limitations: ["public repository history only"],
		authorization: {
			required: false,
			confirmed: true,
			paid: false,
		},
		conclusionPolicy: "observation_only",
		...overrides,
	};
}

describe("byosan active probe contract", () => {
	test("tokenizer fingerprints are deterministic across input ordering", () => {
		const left = tokenizerFingerprint([
			{ input: "hello", tokenCount: 1 },
			{ input: "東京", tokenCount: 2 },
		]);
		const right = tokenizerFingerprint([
			{ input: "東京", tokenCount: 2 },
			{ input: "hello", tokenCount: 1 },
		]);
		expect(right).toBe(left);
	});

	test("document diff preserves before and after fingerprints", () => {
		const result = summarizeTextDiff("a\nb", "a\nc");
		expect(result.addedLines).toEqual(["c"]);
		expect(result.removedLines).toEqual(["b"]);
		expect(result.beforeHash).not.toBe(result.afterHash);
	});

	test("VERIFIED probes require actual execution evidence", () => {
		const item = evidence({
			executedAt: undefined,
			observedResult: undefined,
		});
		const codes = auditByosanActiveProbeEvidence(item).map(
			(issue) => issue.code,
		);
		expect(codes).toContain("verified_probe_execution_time_missing");
		expect(codes).toContain("verified_probe_observation_missing");
	});

	test("authorized API probes cannot claim verification without authorization", () => {
		const item = evidence({
			probeType: "authorized_api",
			authorization: {
				required: true,
				confirmed: false,
				paid: false,
			},
		});
		expect(
			auditByosanActiveProbeEvidence(item).map((issue) => issue.code),
		).toContain("api_probe_authorization_missing");
	});

	test("secret-like material is rejected from persisted evidence", () => {
		const item = evidence({
			observedResult: "Authorization: Bearer abcdefghijklmnop",
		});
		expect(
			auditByosanActiveProbeEvidence(item).map((issue) => issue.code),
		).toContain("probe_artifact_contains_secret_like_material");
	});
});
