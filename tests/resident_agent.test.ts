import { afterAll, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	acquireResidentLock,
	answerHumanQuestion,
	ensureLedgers,
	executeWorkCycle,
	type ResidentStep,
	resolveResidentPaths,
	saveQuestionLedger,
} from "../src/domain/resident/ledgers.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-resident-test-"));

afterAll(() => {
	fs.removeSync(tmpRoot);
});

function makePaths(name: string) {
	const root = path.join(tmpRoot, name);
	return resolveResidentPaths(root);
}

describe("Kafstyler resident agent ledgers, resumability, and idempotency", () => {
	it("1. zero-question autonomous case opens both ledgers, registers 0 questions, and reaches verified", () => {
		const paths = makePaths("zero-question");
		const result = executeWorkCycle({
			paths,
			workId: "work:clean",
			target: "yt3:test",
			goal: "complete autonomously with zero human questions",
			schedule: "hourly",
			triggerId: "hourly:2026-11-20T10:00+09:00",
			inputVersion: "abc1234",
			steps: [
				{
					id: "step_a",
					run: () => ({ status: "verified", ref: "artifact://a" }),
				},
				{
					id: "step_b",
					run: () => ({ status: "verified", ref: "artifact://b" }),
				},
			],
		});

		expect(result.skipped_due_to_lock).toBe(false);
		expect(result.work?.status).toBe("verified");
		expect(result.work?.completed_steps).toEqual(["step_a", "step_b"]);
		expect(result.work?.next_step).toBeNull();
		expect(result.open_questions.length).toBe(0);

		const { workLedger, questionLedger } = ensureLedgers(paths);
		expect(workLedger.items.length).toBe(1);
		expect(questionLedger.questions.length).toBe(0);
	});

	it("2. replay after crash right after external write reads back external truth and performs 0 duplicate writes", () => {
		const paths = makePaths("replay-idempotent");
		let externalWrites = 0;
		let externalRef: string | null = null;

		const makeSteps = (crashAfterWrite: boolean): ResidentStep[] => [
			{
				id: "external_publish",
				externalWriteKey: "ext:2026-11-20:item1",
				verifyExternal: () => externalRef,
				run: () => {
					externalWrites += 1;
					externalRef = "remote://receipt/1";
					if (crashAfterWrite) {
						throw new Error("Simulated disconnect right after external write");
					}
					return { status: "verified", ref: externalRef };
				},
			},
		];

		// First attempt: external write lands, then process fails before verifying locally
		const first = executeWorkCycle({
			paths,
			workId: "work:ext",
			target: "yt3:ext",
			goal: "idempotent external write",
			schedule: "hourly",
			triggerId: "event:100",
			inputVersion: "abc1234",
			steps: makeSteps(true),
		});
		expect(first.work?.status).toBe("failed");
		expect(externalWrites).toBe(1);

		// Second attempt (replay same event): verifyExternal reconciles, NO duplicate external write!
		const second = executeWorkCycle({
			paths,
			workId: "work:ext",
			target: "yt3:ext",
			goal: "idempotent external write",
			schedule: "hourly",
			triggerId: "event:100",
			inputVersion: "abc1234",
			steps: makeSteps(false),
		});
		expect(second.work?.status).toBe("verified");
		expect(externalWrites).toBe(1);
		expect(
			second.work?.external_write_keys["ext:2026-11-20:item1"]?.status,
		).toBe("verified");

		// Third attempt (exact same trigger replay after verified): skipped cleanly
		const third = executeWorkCycle({
			paths,
			workId: "work:ext",
			target: "yt3:ext",
			goal: "idempotent external write",
			schedule: "hourly",
			triggerId: "event:100",
			inputVersion: "abc1234",
			steps: makeSteps(false),
		});
		expect(third.replayed_verified).toBe(true);
		expect(externalWrites).toBe(1);
	});

	it("3. concurrent overlapping execution enforces single-writer lock (<= 1 concurrent writer)", () => {
		const paths = makePaths("concurrent-lock");
		const lock = acquireResidentLock(paths.lockPath, "active-writer");
		expect(lock).not.toBeNull();

		try {
			const blocked = executeWorkCycle({
				paths,
				workId: "work:overlap",
				target: "yt3:overlap",
				goal: "must not overlap",
				schedule: "hourly",
				triggerId: "hourly:1",
				inputVersion: "abc1234",
				steps: [
					{
						id: "step_1",
						run: () => ({ status: "verified", ref: "ref://1" }),
					},
				],
			});
			expect(blocked.skipped_due_to_lock).toBe(true);
			expect(blocked.work).toBeNull();
		} finally {
			lock?.release();
		}

		// Once lock is released, next execution runs cleanly
		const afterRelease = executeWorkCycle({
			paths,
			workId: "work:overlap",
			target: "yt3:overlap",
			goal: "must not overlap",
			schedule: "hourly",
			triggerId: "hourly:1",
			inputVersion: "abc1234",
			steps: [
				{
					id: "step_1",
					run: () => ({ status: "verified", ref: "ref://1" }),
				},
			],
		});
		expect(afterRelease.skipped_due_to_lock).toBe(false);
		expect(afterRelease.work?.status).toBe("verified");
	});

	it("4. mid-run interruption resumes in a new session from next_step without re-running completed steps", () => {
		const paths = makePaths("mid-run-resume");
		const executed: string[] = [];
		let failSecond = true;

		const steps: ResidentStep[] = [
			{
				id: "prepare",
				run: () => {
					executed.push("prepare");
					return { status: "verified", ref: "local://prepared" };
				},
			},
			{
				id: "verify_output",
				run: () => {
					executed.push("verify_output");
					if (failSecond) {
						return {
							status: "failed",
							error: "transient verification timeout",
						};
					}
					return { status: "verified", ref: "local://verified" };
				},
			},
		];

		const session1 = executeWorkCycle({
			paths,
			workId: "work:resume",
			target: "yt3:resume",
			goal: "resume across sessions",
			schedule: "hourly",
			triggerId: "hourly:2",
			inputVersion: "v1",
			steps,
		});
		expect(session1.work?.status).toBe("failed");
		expect(session1.work?.completed_steps).toEqual(["prepare"]);
		expect(session1.work?.next_step).toBe("verify_output");

		failSecond = false;
		const session2 = executeWorkCycle({
			paths,
			workId: "work:resume",
			target: "yt3:resume",
			goal: "resume across sessions",
			schedule: "hourly",
			triggerId: "hourly:2",
			inputVersion: "v1",
			steps,
		});
		expect(session2.work?.status).toBe("verified");
		expect(executed).toEqual(["prepare", "verify_output", "verify_output"]);
	});

	it("5. human-blocked step deduplicates 1 question across retries, completes independent steps, and resumes after answer", () => {
		const paths = makePaths("human-question");
		let independentRuns = 0;

		const steps: ResidentStep[] = [
			{
				id: "owner_gated_step",
				run: ({ questionLedger }) => {
					const existing = questionLedger.questions.find(
						(q) =>
							q.target === "gcp:659942893881" &&
							q.decision_topic === "enable_api",
					);
					if (existing?.status === "answered") {
						return {
							status: "verified",
							ref: `answered:${existing.answer_ref ?? "ok"}`,
						};
					}
					return {
						status: "needs_human",
						question: {
							target: "gcp:659942893881",
							decision_topic: "enable_api",
							question: "Enable YouTube Analytics API?",
							rationale: "Agent lacks GCP console permission",
							alternatives_checked: ["dbt fixture build verified"],
							blocked_step: "owner_gated_step",
							resume_condition: "API enabled in GCP console",
						},
					};
				},
			},
			{
				id: "independent_step",
				run: () => {
					independentRuns += 1;
					return { status: "verified", ref: "local://independent-ok" };
				},
			},
		];

		// Tick 1: owner-gated step opens 1 question, independent step STILL completes!
		const tick1 = executeWorkCycle({
			paths,
			workId: "work:human",
			target: "yt3:human",
			goal: "test human question ledger",
			schedule: "hourly",
			triggerId: "hourly:3",
			inputVersion: "v1",
			steps,
		});
		expect(tick1.work?.status).toBe("waiting_human");
		expect(tick1.work?.completed_steps).toEqual(["independent_step"]);
		expect(tick1.open_questions.length).toBe(1);
		expect(independentRuns).toBe(1);

		// Tick 2 (before answer): still exactly 1 deduplicated question, independent step not re-run!
		const tick2 = executeWorkCycle({
			paths,
			workId: "work:human",
			target: "yt3:human",
			goal: "test human question ledger",
			schedule: "hourly",
			triggerId: "hourly:3",
			inputVersion: "v1",
			steps,
		});
		expect(tick2.work?.status).toBe("waiting_human");
		expect(tick2.open_questions.length).toBe(1);
		expect(independentRuns).toBe(1);

		// Owner answers the question
		const qId = tick2.open_questions[0]?.question_id ?? "";
		const { questionLedger } = ensureLedgers(paths);
		answerHumanQuestion(
			questionLedger,
			qId,
			"owner-chat:2026-11-20",
			"Enabled API",
		);
		saveQuestionLedger(paths, questionLedger);

		// Tick 3 (after answer): blocked step resumes and reaches verified!
		const tick3 = executeWorkCycle({
			paths,
			workId: "work:human",
			target: "yt3:human",
			goal: "test human question ledger",
			schedule: "hourly",
			triggerId: "hourly:3",
			inputVersion: "v1",
			steps,
		});
		expect(tick3.work?.status).toBe("verified");
		expect(tick3.work?.completed_steps).toEqual([
			"independent_step",
			"owner_gated_step",
		]);
		expect(tick3.open_questions.length).toBe(0);
	});

	it("6. recurring hourly triggers while waiting_human keep refreshing independent steps without hitting max_attempts", () => {
		const paths = makePaths("recurring-waiting-human");
		let independentRuns = 0;
		const steps: ResidentStep[] = [
			{
				id: "refresh_snapshot",
				run: () => {
					independentRuns += 1;
					return { status: "verified", ref: `snap://${independentRuns}` };
				},
			},
			{
				id: "owner_blocker",
				run: () => ({
					status: "needs_human",
					question: {
						target: "gcp:659942893881",
						decision_topic: "enable_api",
						question: "Enable API?",
						rationale: "Owner permission required",
						alternatives_checked: ["checked"],
						blocked_step: "owner_blocker",
						resume_condition: "API enabled",
					},
				}),
			},
		];

		for (let hour = 1; hour <= 6; hour++) {
			const res = executeWorkCycle({
				paths,
				workId: "work:hourly",
				target: "yt3:all",
				goal: "recurring hourly ops",
				schedule: "hourly",
				triggerId: `hourly:2026-11-20T0${hour}:00+09:00`,
				inputVersion: "v1",
				maxAttempts: 3,
				steps,
			});
			expect(res.work?.status).toBe("waiting_human");
			expect(res.open_questions.length).toBe(1);
		}
		expect(independentRuns).toBe(6);
	});
});
