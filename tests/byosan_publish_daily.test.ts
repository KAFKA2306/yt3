import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type PublishDailyDeps,
	runByosanPublishDaily,
	type TaskResult,
	tokyoDate,
} from "../src/scripts/byosan_publish_daily.js";

const RUN_ID = "byosan_money/2026-10-13-daily-0100";
const CHANNEL_ID = "UCYtjO-PYBfdG3MuPLXfhA-Q";
const ARTIFACT_SHA = "a".repeat(64);
const NOW_JST_NEXT_DAY = new Date("2026-10-12T16:00:00Z");
const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

async function makeRoot(): Promise<string> {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "byosan-publish-daily-test-"),
	);
	tempRoots.push(root);
	writeByosanConfig(root);
	return root;
}

function writeByosanConfig(root: string): void {
	fs.outputFileSync(
		path.join(root, "config/domains/byosan_money.yaml"),
		"prompts:\n  research: {}\ndiscovery: {}\nexplain: {}\nrepair: {}\nllm: {}\n",
	);
}

function publishDir(root: string): string {
	return path.join(root, "runs", RUN_ID, "publish");
}

function readyRecord(root: string): { status: string } {
	return fs.readJsonSync(path.join(publishDir(root), "ready.json"));
}

function gateOutput(): string {
	return [
		`[product-release-gate] PASS profile=byosan run=${RUN_ID} artifact_sha256=${ARTIFACT_SHA}`,
		`PUBLISH_READY_RUN=${RUN_ID}`,
		`PUBLISH_COMMAND=task publish PROFILE=byosan -- ${RUN_ID}`,
	].join("\n");
}

function writeReceipt(root: string, withAttestations = true): void {
	fs.outputJsonSync(path.join(publishDir(root), "receipt.json"), {
		youtube: {
			status: "uploaded",
			video_id: "vid123",
			channel_id: CHANNEL_ID,
			privacy_status: "public",
		},
	});
	if (!withAttestations) return;
	fs.outputJsonSync(
		path.join(publishDir(root), "visibility_attestation.json"),
		{
			current_privacy_status: "public",
			channel_id: CHANNEL_ID,
		},
	);
	fs.outputJsonSync(path.join(publishDir(root), "thumbnail_attestation.json"), {
		api_update_status: "succeeded",
	});
}

function deps(
	root: string,
	runTask: PublishDailyDeps["runTask"],
	overrides: Partial<PublishDailyDeps> = {},
): PublishDailyDeps {
	return {
		root,
		now: NOW_JST_NEXT_DAY,
		timezone: "Asia/Tokyo",
		resumeDate: "2026-10-13",
		publishApproved: true,
		runTask,
		...overrides,
	};
}

function recordingRunner(
	handle: (args: string[], root: string) => TaskResult,
	root: string,
): { calls: string[][]; runTask: PublishDailyDeps["runTask"] } {
	const calls: string[][] = [];
	return {
		calls,
		runTask: (args) => {
			calls.push(args);
			return handle(args, root);
		},
	};
}

describe("byosan daily publish gate", () => {
	test("uses the Asia/Tokyo calendar date for the explicit DATE", () => {
		expect(tokyoDate(NOW_JST_NEXT_DAY, "Asia/Tokyo")).toBe("2026-10-13");
	});

	test("publishes only after the gate emits all three evidence lines for the same run", () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "byosan-publish-daily-test-"),
		);
		tempRoots.push(root);
		writeByosanConfig(root);
		const runner = recordingRunner((args, dir) => {
			if (args[0] === "byosan:auto") return { status: 0, output: gateOutput() };
			writeReceipt(dir);
			return { status: 0, output: "" };
		}, root);

		runByosanPublishDaily(deps(root, runner.runTask));

		expect(runner.calls).toEqual([
			["byosan:auto", "DATE=2026-10-13"],
			["publish", "PROFILE=byosan", "--", RUN_ID],
		]);
		expect(readyRecord(root).status).toBe("PUBLISHED");
	});

	test("does not publish when a required gate evidence line is missing", async () => {
		const root = await makeRoot();
		const runner = recordingRunner(
			() => ({
				status: 0,
				output: gateOutput().replace(/^PUBLISH_COMMAND=.*$/m, ""),
			}),
			root,
		);

		expect(() => runByosanPublishDaily(deps(root, runner.runTask))).toThrow(
			"PREPARE_GATE_FAILED",
		);
		expect(runner.calls).toEqual([["byosan:auto", "DATE=2026-10-13"]]);
		expect(readyRecord(root).status).toBe("GATE_FAILED");
	});

	test("does not publish when the release gate fails", async () => {
		const root = await makeRoot();
		const runner = recordingRunner(() => ({ status: 1, output: "" }), root);

		expect(() => runByosanPublishDaily(deps(root, runner.runTask))).toThrow(
			"PREPARE_GATE_FAILED",
		);
		expect(runner.calls).toEqual([["byosan:auto", "DATE=2026-10-13"]]);
	});

	test("re-prepares a same-date run after a recorded gate failure", async () => {
		const root = await makeRoot();
		fs.outputJsonSync(path.join(publishDir(root), "ready.json"), {
			run_id: RUN_ID,
			status: "GATE_FAILED",
			reason: "prepare_status=201",
			recorded_at: NOW_JST_NEXT_DAY.toISOString(),
		});
		const runner = recordingRunner((args, dir) => {
			if (args[0] === "byosan:auto") return { status: 0, output: gateOutput() };
			writeReceipt(dir);
			return { status: 0, output: "" };
		}, root);

		runByosanPublishDaily(deps(root, runner.runTask));

		expect(runner.calls).toEqual([
			["byosan:auto", "DATE=2026-10-13"],
			["publish", "PROFILE=byosan", "--", RUN_ID],
		]);
		expect(readyRecord(root).status).toBe("PUBLISHED");
	});

	test("records the gate failure again when the same-date re-prepare fails", async () => {
		const root = await makeRoot();
		fs.outputJsonSync(path.join(publishDir(root), "ready.json"), {
			run_id: RUN_ID,
			status: "GATE_FAILED",
			reason: "prepare_status=201",
			recorded_at: NOW_JST_NEXT_DAY.toISOString(),
		});
		const runner = recordingRunner(() => ({ status: 1, output: "" }), root);

		expect(() => runByosanPublishDaily(deps(root, runner.runTask))).toThrow(
			"PREPARE_GATE_FAILED",
		);
		expect(runner.calls).toEqual([["byosan:auto", "DATE=2026-10-13"]]);
		expect(readyRecord(root).status).toBe("GATE_FAILED");
	});

	test("blocks a same-date retry while a publish attempt is in flight or recorded as published", async () => {
		for (const status of ["PUBLISH_ATTEMPTED", "PUBLISHED"]) {
			const root = await makeRoot();
			fs.outputJsonSync(path.join(publishDir(root), "ready.json"), {
				run_id: RUN_ID,
				status,
				artifact_sha256: ARTIFACT_SHA,
				recorded_at: NOW_JST_NEXT_DAY.toISOString(),
			});
			const runner = recordingRunner(
				() => ({ status: 0, output: gateOutput() }),
				root,
			);

			expect(() => runByosanPublishDaily(deps(root, runner.runTask))).toThrow(
				"SAME_DATE_RETRY_BLOCKED",
			);
			expect(runner.calls).toEqual([]);
		}
	});

	test("holds publication without calling publish when publish_approved is false", async () => {
		const root = await makeRoot();
		const runner = recordingRunner(
			() => ({ status: 0, output: gateOutput() }),
			root,
		);

		runByosanPublishDaily(
			deps(root, runner.runTask, { publishApproved: false }),
		);

		expect(runner.calls).toEqual([["byosan:auto", "DATE=2026-10-13"]]);
		expect(readyRecord(root).status).toBe("READY");
	});

	test("does not report success when the publish command leaves no verified receipt", async () => {
		const root = await makeRoot();
		const runner = recordingRunner(
			(args) =>
				args[0] === "byosan:auto"
					? { status: 0, output: gateOutput() }
					: { status: 0, output: "" },
			root,
		);

		expect(() => runByosanPublishDaily(deps(root, runner.runTask))).toThrow(
			"PUBLISH_EVIDENCE_INCOMPLETE",
		);
		expect(readyRecord(root).status).toBe("PUBLISH_ATTEMPTED");
	});

	test("does not prepare or publish dates before the resume date", async () => {
		const root = await makeRoot();
		const runner = recordingRunner(
			() => ({ status: 0, output: gateOutput() }),
			root,
		);

		runByosanPublishDaily(
			deps(root, runner.runTask, {
				now: new Date("2026-10-12T02:00:00Z"),
			}),
		);

		expect(runner.calls).toEqual([]);
	});
});
