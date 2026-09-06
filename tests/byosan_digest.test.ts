import { describe, expect, test } from "bun:test";
import {
	type ByosanDigestContext,
	auditByosanDigestContext,
	formatDigestWatchlistItem,
} from "../src/domain/byosan/digest_contract.js";
import {
	type DigestInput,
	dedupeDigestInputs,
	digestStartDate,
} from "../src/scripts/build_byosan_digest.js";

function input(runId: string, asOf: string, searchQuery: string): DigestInput {
	return {
		runId,
		runDir: `/tmp/${runId}`,
		videoPath: `/tmp/${runId}.mp4`,
		spec: {
			asOf,
			searchQuery,
		} as DigestInput["spec"],
		state: {} as DigestInput["state"],
	};
}

function context(
	overrides: Partial<ByosanDigestContext> = {},
): ByosanDigestContext {
	return {
		schemaVersion: "byosan_digest_context_v2",
		period: "week",
		start: "2026-08-31",
		end: "2026-09-06",
		baselineAlignments: [
			{
				metric: "benchmark score",
				authorityName: "Benchmark Authority",
				authorityUrl: "https://example.com/benchmark",
				baselineVersion: "v4.2",
				baselineAsOf: "2026-09-06",
				status: "REALIGNED",
				inputs: [
					{
						runId: "byosan_money/2026-09-03-daily",
						originalValue: "64.6",
						originalBaselineVersion: "v4.1.1",
						originalAsOf: "2026-09-03",
						normalizedValue: "63.9",
						formula: "recompute with v4.2 published comparator set",
					},
				],
				limitations: ["historical source uses an older benchmark version"],
			},
		],
		macroSynthesis: [
			{
				axis: "structure",
				claim: "複数プレイヤーの同時投入で競争構図が変化した",
				sourceRunIds: ["byosan_money/2026-09-03-daily"],
				sourceClaimIds: ["claim_a"],
				sourceUrls: ["https://example.com/source-a"],
			},
			{
				axis: "relative_economics",
				claim: "価格帯が高価格帯と実用価格帯へ分かれた",
				sourceRunIds: ["byosan_money/2026-09-03-daily"],
				sourceClaimIds: ["claim_b"],
				sourceUrls: ["https://example.com/source-b"],
			},
			{
				axis: "policy_distribution_risk",
				claim: "配布と安全運用の姿勢に差が出た",
				sourceRunIds: ["byosan_money/2026-09-03-daily"],
				sourceClaimIds: ["claim_c"],
				sourceUrls: ["https://example.com/source-c"],
			},
		],
		watchlist: [
			{
				event: "雇用統計",
				scheduledAt: "2026-09-11T12:30:00.000Z",
				status: "confirmed",
				sourceUrl: "https://example.com/calendar",
				whatWouldChange: "金利と為替の短期評価",
			},
			{
				event: "モデル公開予告",
				scheduledAt: "2026-09-12T00:00:00.000Z",
				status: "tentative",
				sourceUrl: "https://example.com/release",
				whatWouldChange: "競争構図の比較基準",
			},
			{
				event: "決算発表",
				scheduledAt: "2026-09-13T00:00:00.000Z",
				status: "confirmed",
				sourceUrl: "https://example.com/earnings",
				whatWouldChange: "利益成長の確定値",
			},
		],
		navigation: [
			{
				runId: "byosan_money/2026-09-03-daily",
				title: "日次検証",
			},
		],
		...overrides,
	};
}

describe("byosan digest", () => {
	test("week and month ranges are explicit and deterministic", () => {
		expect(digestStartDate("week", "2026-09-06")).toBe("2026-08-31");
		expect(digestStartDate("month", "2026-09-06")).toBe("2026-09-01");
	});

	test("baseline version changes cannot pass as unchanged", () => {
		const item = context();
		const alignment = item.baselineAlignments[0];
		if (!alignment) throw new Error("baseline fixture is missing");
		alignment.status = "UNCHANGED";
		const issues = auditByosanDigestContext(
			item,
			["byosan_money/2026-09-03-daily"],
			new Map([
				[
					"byosan_money/2026-09-03-daily",
					new Set(["claim_a", "claim_b", "claim_c"]),
				],
			]),
		);
		expect(issues.map((issue) => issue.code)).toContain(
			"baseline_mismatch_not_realigned",
		);
	});

	test("unverified baselines cannot fabricate normalized values", () => {
		const item = context();
		const alignment = item.baselineAlignments[0];
		const first = alignment?.inputs[0];
		if (!alignment || !first) throw new Error("baseline fixture is missing");
		alignment.status = "UNVERIFIED";
		first.normalizedValue = "63.9";
		first.formula = "guessed conversion";
		const issues = auditByosanDigestContext(
			item,
			["byosan_money/2026-09-03-daily"],
			new Map([
				[
					"byosan_money/2026-09-03-daily",
					new Set(["claim_a", "claim_b", "claim_c"]),
				],
			]),
		);
		expect(issues.map((issue) => issue.code)).toContain(
			"unverified_baseline_must_not_fake_normalization",
		);
	});

	test("macro synthesis must point to input claim ids", () => {
		const item = context();
		const first = item.macroSynthesis[0];
		if (!first) throw new Error("synthesis fixture is missing");
		first.sourceClaimIds = ["missing_claim"];
		const issues = auditByosanDigestContext(
			item,
			["byosan_money/2026-09-03-daily"],
			new Map([
				[
					"byosan_money/2026-09-03-daily",
					new Set(["claim_a", "claim_b", "claim_c"]),
				],
			]),
		);
		expect(issues.map((issue) => issue.code)).toContain(
			"synthesis_claim_provenance_missing",
		);
	});

	test("tentative watchlist items are visibly labeled tentative", () => {
		const tentative = context().watchlist.find(
			(item) => item.status === "tentative",
		);
		if (!tentative) throw new Error("tentative watchlist fixture is missing");
		expect(formatDigestWatchlistItem(tentative)).toContain("暫定予定");
	});

	test("duplicate normalized topics keep the newest verified run", () => {
		const selected = dedupeDigestInputs([
			input("byosan_money/2026-09-01-daily", "2026-09-01", "FOMC   RATE"),
			input("byosan_money/2026-09-03-daily", "2026-09-03", "fomc rate"),
			input("byosan_money/2026-09-02-daily", "2026-09-02", "jobs report"),
		]);
		expect(selected.map((item) => item.runId)).toEqual([
			"byosan_money/2026-09-02-daily",
			"byosan_money/2026-09-03-daily",
		]);
	});
});
