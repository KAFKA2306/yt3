import { describe, expect, test } from "bun:test";
import {
	dedupeDigestInputs,
	digestStartDate,
	type DigestInput,
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

describe("byosan digest", () => {
	test("week and month ranges are explicit and deterministic", () => {
		expect(digestStartDate("week", "2026-09-06")).toBe("2026-08-31");
		expect(digestStartDate("month", "2026-09-06")).toBe("2026-09-01");
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
