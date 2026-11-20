import crypto from "node:crypto";
import fsNode from "node:fs";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

export const RESIDENT_SCHEMA_VERSION = 1 as const;

export const WorkStatusSchema = z.enum([
	"accepted",
	"running",
	"waiting_human",
	"failed",
	"aborted",
	"verified",
]);

export const ExternalWriteRecordSchema = z.object({
	status: z.enum(["dispatched", "verified"]),
	ref: z.string(),
	at: z.string(),
});

export const WorkItemSchema = z.object({
	work_id: z.string().min(1),
	target: z.string().min(1),
	goal: z.string().min(1),
	schedule: z.string().min(1),
	timezone: z.string().default("Asia/Tokyo"),
	trigger_id: z.string().min(1),
	attempt_id: z.string().min(1),
	input_version: z.string().min(1),
	status: WorkStatusSchema,
	attempts_used: z.number().int().nonnegative(),
	max_attempts: z.number().int().positive(),
	completed_steps: z.array(z.string()),
	next_step: z.string().nullable(),
	last_verified_ref: z.string().nullable(),
	external_write_keys: z.record(z.string(), ExternalWriteRecordSchema),
	linked_question_ids: z.array(z.string()),
	last_error: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const WorkLedgerSchema = z.object({
	schema_version: z.literal(RESIDENT_SCHEMA_VERSION),
	updated_at: z.string(),
	items: z.array(WorkItemSchema),
});

export const QuestionStatusSchema = z.enum([
	"open",
	"answered",
	"resolved_obsolete",
]);

export const QuestionRecordSchema = z.object({
	question_id: z.string().min(1),
	target: z.string().min(1),
	decision_topic: z.string().min(1),
	question: z.string().min(1),
	respondent: z.string().min(1),
	rationale: z.string().min(1),
	alternatives_checked: z.array(z.string()),
	blocked_step: z.string().min(1),
	resume_condition: z.string().min(1),
	status: QuestionStatusSchema,
	answer_ref: z.string().nullable(),
	answer_summary: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const QuestionLedgerSchema = z.object({
	schema_version: z.literal(RESIDENT_SCHEMA_VERSION),
	updated_at: z.string(),
	questions: z.array(QuestionRecordSchema),
});

export type WorkItem = z.infer<typeof WorkItemSchema>;
export type WorkLedger = z.infer<typeof WorkLedgerSchema>;
export type QuestionRecord = z.infer<typeof QuestionRecordSchema>;
export type QuestionLedger = z.infer<typeof QuestionLedgerSchema>;

export type LedgerPaths = {
	stateDir: string;
	workLedgerPath: string;
	questionLedgerPath: string;
	lockPath: string;
	eventLogPath: string;
};

export function resolveResidentPaths(
	repoRoot: string,
	overrideStateDir?: string,
): LedgerPaths {
	const stateDir =
		overrideStateDir ?? path.join(repoRoot, "data", "state", "resident");
	return {
		stateDir,
		workLedgerPath: path.join(stateDir, "work_ledger.json"),
		questionLedgerPath: path.join(stateDir, "question_ledger.json"),
		lockPath: path.join(stateDir, "agent.lock"),
		eventLogPath: path.join(repoRoot, "logs", "resident-agent.jsonl"),
	};
}

function writeJsonAtomic(filePath: string, data: unknown): void {
	fs.ensureDirSync(path.dirname(filePath));
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeJsonSync(tmp, data, { spaces: 2 });
	fs.moveSync(tmp, filePath, { overwrite: true });
}

export function ensureLedgers(paths: LedgerPaths): {
	workLedger: WorkLedger;
	questionLedger: QuestionLedger;
} {
	fs.ensureDirSync(paths.stateDir);
	const now = new Date().toISOString();

	let workLedger: WorkLedger;
	if (fs.existsSync(paths.workLedgerPath)) {
		workLedger = WorkLedgerSchema.parse(fs.readJsonSync(paths.workLedgerPath));
	} else {
		workLedger = {
			schema_version: RESIDENT_SCHEMA_VERSION,
			updated_at: now,
			items: [],
		};
		writeJsonAtomic(paths.workLedgerPath, workLedger);
	}

	let questionLedger: QuestionLedger;
	if (fs.existsSync(paths.questionLedgerPath)) {
		questionLedger = QuestionLedgerSchema.parse(
			fs.readJsonSync(paths.questionLedgerPath),
		);
	} else {
		questionLedger = {
			schema_version: RESIDENT_SCHEMA_VERSION,
			updated_at: now,
			questions: [],
		};
		writeJsonAtomic(paths.questionLedgerPath, questionLedger);
	}

	return { workLedger, questionLedger };
}

export function saveWorkLedger(paths: LedgerPaths, ledger: WorkLedger): void {
	ledger.updated_at = new Date().toISOString();
	writeJsonAtomic(paths.workLedgerPath, WorkLedgerSchema.parse(ledger));
}

export function saveQuestionLedger(
	paths: LedgerPaths,
	ledger: QuestionLedger,
): void {
	ledger.updated_at = new Date().toISOString();
	writeJsonAtomic(paths.questionLedgerPath, QuestionLedgerSchema.parse(ledger));
}

export function appendResidentEvent(
	paths: LedgerPaths,
	event: {
		event: string;
		work_id?: string;
		trigger_id?: string;
		attempt_id?: string;
		status?: string;
		detail: string;
	},
): void {
	fs.ensureDirSync(path.dirname(paths.eventLogPath));
	const line = `${JSON.stringify({
		at: new Date().toISOString(),
		...event,
	})}\n`;
	fs.appendFileSync(paths.eventLogPath, line, "utf8");
}

function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export type LockHandle = {
	lockPath: string;
	token: string;
	release: () => void;
};

export function acquireResidentLock(
	lockPath: string,
	ownerLabel: string,
): LockHandle | null {
	fs.ensureDirSync(path.dirname(lockPath));
	const token = `${process.pid}-${crypto.randomUUID()}`;
	const payload = JSON.stringify({
		pid: process.pid,
		token,
		owner: ownerLabel,
		acquired_at: new Date().toISOString(),
	});

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = fsNode.openSync(lockPath, "wx");
			fsNode.writeFileSync(fd, payload, "utf8");
			fsNode.closeSync(fd);
			return {
				lockPath,
				token,
				release: () => {
					try {
						if (!fs.existsSync(lockPath)) return;
						const current = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
							token?: string;
						};
						if (current.token === token) {
							fs.removeSync(lockPath);
						}
					} catch {
						// Best-effort cleanup
					}
				},
			};
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw err;
			try {
				const existing = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
					pid?: number;
				};
				if (typeof existing.pid === "number" && isPidAlive(existing.pid)) {
					return null;
				}
				// Stale lock from dead process
				fs.removeSync(lockPath);
			} catch {
				return null;
			}
		}
	}
	return null;
}

export function stableQuestionId(
	target: string,
	decisionTopic: string,
): string {
	const slug = `${target}-${decisionTopic}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	const hash = crypto
		.createHash("sha256")
		.update(`${target}::${decisionTopic}`)
		.digest("hex")
		.slice(0, 8);
	return `q-${slug}-${hash}`;
}

export type UpsertQuestionInput = {
	target: string;
	decision_topic: string;
	question: string;
	respondent?: string;
	rationale: string;
	alternatives_checked: string[];
	blocked_step: string;
	resume_condition: string;
};

export function upsertHumanQuestion(
	ledger: QuestionLedger,
	input: UpsertQuestionInput,
): QuestionRecord {
	const now = new Date().toISOString();
	const existing = ledger.questions.find(
		(q) =>
			q.target === input.target && q.decision_topic === input.decision_topic,
	);
	if (existing) {
		existing.question = input.question;
		existing.rationale = input.rationale;
		existing.alternatives_checked = input.alternatives_checked;
		existing.blocked_step = input.blocked_step;
		existing.resume_condition = input.resume_condition;
		existing.updated_at = now;
		if (existing.status === "resolved_obsolete") {
			existing.status = "open";
		}
		return existing;
	}
	const record: QuestionRecord = {
		question_id: stableQuestionId(input.target, input.decision_topic),
		target: input.target,
		decision_topic: input.decision_topic,
		question: input.question,
		respondent: input.respondent ?? "owner",
		rationale: input.rationale,
		alternatives_checked: input.alternatives_checked,
		blocked_step: input.blocked_step,
		resume_condition: input.resume_condition,
		status: "open",
		answer_ref: null,
		answer_summary: null,
		created_at: now,
		updated_at: now,
	};
	ledger.questions.push(record);
	return record;
}

export function answerHumanQuestion(
	ledger: QuestionLedger,
	questionId: string,
	answerRef: string,
	answerSummary: string,
): QuestionRecord {
	const target = ledger.questions.find((q) => q.question_id === questionId);
	if (!target) {
		throw new Error(`Question not found: ${questionId}`);
	}
	target.status = "answered";
	target.answer_ref = answerRef;
	target.answer_summary = answerSummary;
	target.updated_at = new Date().toISOString();
	return target;
}

export function resolveHumanQuestionObsolete(
	ledger: QuestionLedger,
	targetName: string,
	decisionTopic: string,
	reason: string,
): QuestionRecord | null {
	const existing = ledger.questions.find(
		(q) => q.target === targetName && q.decision_topic === decisionTopic,
	);
	if (existing?.status !== "open") return null;
	existing.status = "resolved_obsolete";
	existing.answer_summary = reason;
	existing.updated_at = new Date().toISOString();
	return existing;
}

export type StepOutcome =
	| { status: "verified"; ref: string; detail?: string }
	| {
			status: "needs_human";
			question: UpsertQuestionInput;
			detail?: string;
	  }
	| { status: "failed"; error: string };

export type ResidentStep = {
	id: string;
	externalWriteKey?: string;
	/**
	 * Read-back check against external source of truth BEFORE performing an external write.
	 * If it returns a non-null ref, the write already succeeded earlier and must not be duplicated.
	 */
	verifyExternal?: () => string | null;
	run: (ctx: { work: WorkItem; questionLedger: QuestionLedger }) => StepOutcome;
};

export type ExecuteWorkCycleInput = {
	paths: LedgerPaths;
	workId: string;
	target: string;
	goal: string;
	schedule: string;
	timezone?: string;
	triggerId: string;
	inputVersion: string;
	maxAttempts?: number;
	steps: ResidentStep[];
};

export type ExecuteWorkCycleResult = {
	skipped_due_to_lock: boolean;
	replayed_verified: boolean;
	work: WorkItem | null;
	open_questions: QuestionRecord[];
};

export function executeWorkCycle(
	input: ExecuteWorkCycleInput,
): ExecuteWorkCycleResult {
	const lock = acquireResidentLock(input.paths.lockPath, input.workId);
	if (!lock) {
		appendResidentEvent(input.paths, {
			event: "skipped_lock",
			work_id: input.workId,
			trigger_id: input.triggerId,
			detail: "another resident execution holds the exclusive lock",
		});
		return {
			skipped_due_to_lock: true,
			replayed_verified: false,
			work: null,
			open_questions: [],
		};
	}

	try {
		const { workLedger, questionLedger } = ensureLedgers(input.paths);
		const now = new Date().toISOString();
		const attemptId = `att-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

		let work = workLedger.items.find((i) => i.work_id === input.workId);
		if (
			work &&
			work.status === "verified" &&
			work.trigger_id === input.triggerId
		) {
			appendResidentEvent(input.paths, {
				event: "replayed_verified",
				work_id: work.work_id,
				trigger_id: input.triggerId,
				attempt_id: attemptId,
				status: work.status,
				detail: "trigger already verified; skipped duplicate execution",
			});
			return {
				skipped_due_to_lock: false,
				replayed_verified: true,
				work,
				open_questions: questionLedger.questions.filter(
					(q) => q.status === "open",
				),
			};
		}

		if (!work) {
			work = {
				work_id: input.workId,
				target: input.target,
				goal: input.goal,
				schedule: input.schedule,
				timezone: input.timezone ?? "Asia/Tokyo",
				trigger_id: input.triggerId,
				attempt_id: attemptId,
				input_version: input.inputVersion,
				status: "accepted",
				attempts_used: 0,
				max_attempts: input.maxAttempts ?? 5,
				completed_steps: [],
				next_step: input.steps[0]?.id ?? null,
				last_verified_ref: null,
				external_write_keys: {},
				linked_question_ids: [],
				last_error: null,
				created_at: now,
				updated_at: now,
			};
			workLedger.items.push(work);
		} else if (
			work.trigger_id !== input.triggerId &&
			(work.status === "verified" || work.status === "waiting_human")
		) {
			// New scheduled cycle for a recurring work_id: refresh per-cycle steps while Question Ledger preserves deduplicated open questions
			work.trigger_id = input.triggerId;
			work.input_version = input.inputVersion;
			work.attempts_used = 0;
			work.completed_steps = [];
			work.next_step = input.steps[0]?.id ?? null;
			work.last_error = null;
			work.status = "accepted";
		}

		if (work.attempts_used >= work.max_attempts) {
			work.status = "aborted";
			work.last_error = `Reached max_attempts (${work.max_attempts})`;
			work.updated_at = new Date().toISOString();
			saveWorkLedger(input.paths, workLedger);
			appendResidentEvent(input.paths, {
				event: "aborted",
				work_id: work.work_id,
				trigger_id: work.trigger_id,
				attempt_id: attemptId,
				status: "aborted",
				detail: work.last_error,
			});
			return {
				skipped_due_to_lock: false,
				replayed_verified: false,
				work,
				open_questions: questionLedger.questions.filter(
					(q) => q.status === "open",
				),
			};
		}

		work.attempt_id = attemptId;
		work.input_version = input.inputVersion;
		work.attempts_used += 1;
		work.status = "running";
		work.last_error = null;
		work.updated_at = new Date().toISOString();
		saveWorkLedger(input.paths, workLedger);

		appendResidentEvent(input.paths, {
			event: "started",
			work_id: work.work_id,
			trigger_id: work.trigger_id,
			attempt_id: attemptId,
			status: "running",
			detail: `attempt ${work.attempts_used}/${work.max_attempts}, next_step=${work.next_step ?? "none"}`,
		});

		const blockedSteps: string[] = [];
		let firstFailure: { stepId: string; error: string } | null = null;

		for (const step of input.steps) {
			if (work.completed_steps.includes(step.id)) continue;

			// Read-back check before any external write (idempotency on crash/replay)
			if (step.externalWriteKey && step.verifyExternal) {
				const alreadyVerifiedRef = step.verifyExternal();
				if (alreadyVerifiedRef) {
					work.external_write_keys[step.externalWriteKey] = {
						status: "verified",
						ref: alreadyVerifiedRef,
						at: new Date().toISOString(),
					};
					work.completed_steps.push(step.id);
					work.last_verified_ref = alreadyVerifiedRef;
					saveWorkLedger(input.paths, workLedger);
					appendResidentEvent(input.paths, {
						event: "step_reconciled_external",
						work_id: work.work_id,
						trigger_id: work.trigger_id,
						attempt_id: attemptId,
						detail: `step=${step.id} already verified externally at ${alreadyVerifiedRef}`,
					});
					continue;
				}
			}

			let outcome: StepOutcome;
			try {
				outcome = step.run({ work, questionLedger });
			} catch (err) {
				outcome = {
					status: "failed",
					error: err instanceof Error ? err.message : String(err),
				};
			}

			if (outcome.status === "verified") {
				if (step.externalWriteKey) {
					work.external_write_keys[step.externalWriteKey] = {
						status: "verified",
						ref: outcome.ref,
						at: new Date().toISOString(),
					};
				}
				work.completed_steps.push(step.id);
				work.last_verified_ref = outcome.ref;
				saveWorkLedger(input.paths, workLedger);
				saveQuestionLedger(input.paths, questionLedger);
			} else if (outcome.status === "needs_human") {
				const q = upsertHumanQuestion(questionLedger, outcome.question);
				if (!work.linked_question_ids.includes(q.question_id)) {
					work.linked_question_ids.push(q.question_id);
				}
				if (q.status === "open") {
					blockedSteps.push(step.id);
				}
				saveQuestionLedger(input.paths, questionLedger);
				saveWorkLedger(input.paths, workLedger);
				// Continue executing remaining independent steps!
			} else {
				firstFailure = { stepId: step.id, error: outcome.error };
				work.last_error = `${step.id}: ${outcome.error}`;
				work.next_step = step.id;
				work.status = "failed";
				work.updated_at = new Date().toISOString();
				saveWorkLedger(input.paths, workLedger);
				saveQuestionLedger(input.paths, questionLedger);
				break;
			}
		}

		if (!firstFailure) {
			const remainingSteps = input.steps
				.map((s) => s.id)
				.filter((id) => !work.completed_steps.includes(id));
			if (remainingSteps.length === 0) {
				work.status = "verified";
				work.next_step = null;
			} else if (blockedSteps.length > 0) {
				work.status = "waiting_human";
				work.next_step = blockedSteps[0] ?? remainingSteps[0] ?? null;
			} else {
				work.status = "failed";
				work.next_step = remainingSteps[0] ?? null;
			}
			work.updated_at = new Date().toISOString();
			saveWorkLedger(input.paths, workLedger);
			saveQuestionLedger(input.paths, questionLedger);
		}

		appendResidentEvent(input.paths, {
			event: "finished",
			work_id: work.work_id,
			trigger_id: work.trigger_id,
			attempt_id: attemptId,
			status: work.status,
			detail: `completed=${work.completed_steps.length}/${input.steps.length}, next_step=${work.next_step ?? "none"}, open_questions=${questionLedger.questions.filter((q) => q.status === "open").length}`,
		});

		return {
			skipped_due_to_lock: false,
			replayed_verified: false,
			work,
			open_questions: questionLedger.questions.filter(
				(q) => q.status === "open",
			),
		};
	} finally {
		lock.release();
	}
}
