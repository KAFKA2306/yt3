import { describe, expect, test } from "bun:test";
import {
	type AutoAction,
	decideAfterPrepare,
} from "../src/scripts/byosan_auto.js";
import type { TaskResult } from "../src/scripts/byosan_publish_daily.js";

const RUN_ID = "byosan_money/2026-10-24-daily";
const OTHER_RUN_ID = "byosan_money/2026-10-23-daily";
const ARTIFACT_SHA = "b".repeat(64);
const FAILED: TaskResult = { status: 1, output: "" };

function gateOutput(runId: string = RUN_ID): string {
	return [
		`[product-release-gate] PASS profile=byosan run=${runId} artifact_sha256=${ARTIFACT_SHA}`,
		`PUBLISH_READY_RUN=${runId}`,
		`PUBLISH_COMMAND=task publish PROFILE=byosan -- ${runId}`,
	].join("\n");
}

function planAttempts(
	results: TaskResult[],
	maxPrepareAttempts: number,
): AutoAction[] {
	return results.map((result, index) =>
		decideAfterPrepare(result, RUN_ID, index + 1, maxPrepareAttempts),
	);
}

describe("byosan auto decision", () => {
	test("stops as publish-ready when the three evidence lines name the same run", () => {
		const action = decideAfterPrepare(
			{ status: 0, output: gateOutput() },
			RUN_ID,
			1,
			3,
		);
		expect(action.kind).toBe("PUBLISH_READY");
		if (action.kind !== "PUBLISH_READY") return;
		expect(action.evidence.runId).toBe(RUN_ID);
		expect(action.evidence.artifactSha256).toBe(ARTIFACT_SHA);
		expect(action.evidence.publishCommand).toBe(
			`task publish PROFILE=byosan -- ${RUN_ID}`,
		);
	});

	test("treats a successful prepare without the evidence lines as a failure", () => {
		const output = gateOutput()
			.split("\n")
			.filter((line) => !line.startsWith("PUBLISH_COMMAND="))
			.join("\n");
		expect(decideAfterPrepare({ status: 0, output }, RUN_ID, 1, 3).kind).toBe(
			"REPAIR",
		);
	});

	test("rejects evidence that names another run", () => {
		expect(
			decideAfterPrepare(
				{ status: 0, output: gateOutput(OTHER_RUN_ID) },
				RUN_ID,
				1,
				3,
			).kind,
		).toBe("REPAIR");
	});

	test("rejects a publish command that is not the canonical publish path", () => {
		const output = gateOutput().replace(
			`task publish PROFILE=byosan -- ${RUN_ID}`,
			`task publish PROFILE=yawa -- ${RUN_ID}`,
		);
		expect(decideAfterPrepare({ status: 0, output }, RUN_ID, 1, 3).kind).toBe(
			"REPAIR",
		);
	});

	test("does not treat evidence lines as ready when the prepare exited non-zero", () => {
		expect(
			decideAfterPrepare({ status: 1, output: gateOutput() }, RUN_ID, 1, 3)
				.kind,
		).toBe("REPAIR");
	});

	test("repairs after a failed prepare while attempts remain", () => {
		expect(decideAfterPrepare(FAILED, RUN_ID, 1, 3)).toEqual({
			kind: "REPAIR",
		});
		expect(decideAfterPrepare(FAILED, RUN_ID, 2, 3)).toEqual({
			kind: "REPAIR",
		});
	});

	test("exhausts without a further repair once the last allowed prepare fails", () => {
		expect(decideAfterPrepare(FAILED, RUN_ID, 3, 3)).toEqual({
			kind: "EXHAUSTED",
		});
	});

	test("with max_prepare_attempts of 1 a failed prepare exhausts immediately", () => {
		expect(decideAfterPrepare(FAILED, RUN_ID, 1, 1)).toEqual({
			kind: "EXHAUSTED",
		});
	});

	test("repairs once after a failed prepare and stops as ready when the re-prepare passes", () => {
		expect(
			planAttempts([FAILED, { status: 0, output: gateOutput() }], 3).map(
				(action) => action.kind,
			),
		).toEqual(["REPAIR", "PUBLISH_READY"]);
	});

	test("a run that never passes uses exactly max_prepare_attempts prepares and max minus one repairs", () => {
		const actions = planAttempts([FAILED, FAILED, FAILED], 3);
		expect(actions.map((action) => action.kind)).toEqual([
			"REPAIR",
			"REPAIR",
			"EXHAUSTED",
		]);
	});
});
