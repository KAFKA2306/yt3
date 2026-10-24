import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	formatZodIssuesForRetry,
	loadConfig,
	parseLlmJson,
	redactLlmEvidence,
} from "../../io/core.js";

export type CodexExecConfig = {
	sandbox: string;
	workdir_prefix: string;
};

export type CodexLlmConfig = CodexExecConfig & {
	max_attempts: number;
	json_only_instruction: string;
};

export type CodexMessage = { role: "system" | "user"; content: string };

export type LlmBackend = "gemini" | "codex";
export type LlmStage = "research" | "feature" | "digest" | "preflight";
export type ByosanLlmConfig = CodexLlmConfig & {
	max_local_repairs: number;
	backends: Record<LlmStage, LlmBackend>;
};

export function byosanLlmConfig(): ByosanLlmConfig {
	return (loadConfig("byosan_money") as unknown as { llm: ByosanLlmConfig })
		.llm;
}

export type ByosanFailureClassification = {
	rate_limit_terms: string[];
	auth_terms: string[];
	mcp_noise_terms: string[];
	transient_max_retries: number;
};

export function byosanFailureClassification(): ByosanFailureClassification {
	return (
		loadConfig("byosan_money") as unknown as {
			failure_classification: ByosanFailureClassification;
		}
	).failure_classification;
}

export function termsMatch(text: string, terms: string[]): boolean {
	return terms.some((term) => new RegExp(term, "i").test(text));
}

export function failureSignalLines(
	text: string,
	noiseTerms: string[],
): string[] {
	return text.split("\n").filter((line) => !termsMatch(line, noiseTerms));
}

export function codexErrorDetail(
	stderr: string,
	classification: ByosanFailureClassification,
): string {
	const lines = failureSignalLines(stderr, classification.mcp_noise_terms);
	const errorLines = lines.filter((line) => line.includes("ERROR:"));
	const otherLines = lines.filter((line) => !line.includes("ERROR:"));
	return [...errorLines, ...otherLines].join("\n").slice(0, 400);
}

export function llmBackend(cfg: ByosanLlmConfig, stage: LlmStage): LlmBackend {
	const backend = cfg.backends?.[stage];
	if (backend === "gemini" || backend === "codex") return backend;
	throw new Error(
		`LLM_BACKEND_INVALID: llm.backends.${stage} must be gemini or codex, got ${String(backend)}`,
	);
}

export type CodexLogRecord = {
	event: "start" | "exec_end" | "validation";
	stage: string;
	attempt: number;
	status: "STARTED" | "EXEC_OK" | "EXEC_FAILED" | "PASS" | "FAIL";
	startedAt?: string;
	endedAt?: string;
	durationMs?: number;
	exitCode?: number | null;
	stdoutBytes?: number;
	stderrBytes?: number;
	stderrTail?: string;
	validationErrors?: string[];
	output?: string;
};

export function codexLlmLogPath(runDir: string): string {
	return path.join(runDir, "audit", "llm_calls.jsonl");
}

export function appendCodexLog(logPath: string, record: CodexLogRecord): void {
	fs.ensureDirSync(path.dirname(logPath));
	fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
	console.log(
		`[codex] stage=${record.stage} attempt=${record.attempt} event=${record.event} status=${record.status} exit=${record.exitCode ?? "-"} durationMs=${record.durationMs ?? "-"} validationErrors=${record.validationErrors?.length ?? 0}`,
	);
}

export type CodexExecOptions = {
	stage: string;
	attempt: number;
	logPath: string;
	outputSchemaPath?: string;
	search?: boolean;
};

export function runCodexExec(
	cfg: CodexExecConfig,
	input: string,
	options: CodexExecOptions,
): string {
	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), cfg.workdir_prefix));
	const outputPath = path.join(workdir, "last_message.txt");
	const base = { stage: options.stage, attempt: options.attempt };
	const startedAt = new Date();
	appendCodexLog(options.logPath, {
		...base,
		event: "start",
		status: "STARTED",
		startedAt: startedAt.toISOString(),
	});
	const result = spawnSync(
		"codex",
		[
			...(options.search ? ["--search"] : []),
			"exec",
			"-C",
			workdir,
			"--sandbox",
			cfg.sandbox,
			"--ephemeral",
			"--skip-git-repo-check",
			"--ignore-user-config",
			...(options.outputSchemaPath
				? ["--output-schema", options.outputSchemaPath]
				: []),
			"-o",
			outputPath,
			"-",
		],
		{ input, encoding: "utf8" },
	);
	const endedAt = new Date();
	const succeeded = result.status === 0;
	appendCodexLog(options.logPath, {
		...base,
		event: "exec_end",
		status: succeeded ? "EXEC_OK" : "EXEC_FAILED",
		startedAt: startedAt.toISOString(),
		endedAt: endedAt.toISOString(),
		durationMs: endedAt.getTime() - startedAt.getTime(),
		exitCode: result.status,
		stdoutBytes: Buffer.byteLength(result.stdout ?? ""),
		stderrBytes: Buffer.byteLength(result.stderr ?? ""),
		stderrTail: `${result.error?.message ?? ""}${result.stderr ?? ""}`.slice(
			-400,
		),
	});
	const text = succeeded ? fs.readFileSync(outputPath, "utf8") : undefined;
	fs.removeSync(workdir);
	if (text === undefined) {
		throw new Error(
			`CODEX_EXEC_FAILED stage=${options.stage} status=${result.status} ${result.error?.message ?? ""} ${codexErrorDetail(result.stderr ?? "", byosanFailureClassification())}`,
		);
	}
	return text;
}

function codexPrompt(
	messages: CodexMessage[],
	jsonOnlyInstruction: string,
): string {
	return [
		...messages.map(
			(message) => `[${message.role.toUpperCase()}]\n${message.content}`,
		),
		jsonOnlyInstruction,
	].join("\n\n");
}

export type StructuredCall<T, U> = Omit<
	CodexStructuredRequest<T, U>,
	"llm" | "logPath"
>;

export function structuredRequest<T, U = T>(
	request: StructuredCall<T, U>,
): StructuredCall<T, U> {
	return request;
}

export type CodexStructuredRequest<T, U> = {
	llm: CodexLlmConfig;
	schema: z.ZodSchema<T>;
	providerSchema?: z.ZodType;
	name: string;
	logPath: string;
	messages: (attempt: number, lastValidationError?: string) => CodexMessage[];
	validate?: (value: T) => U;
	maxAttempts?: number;
	search?: boolean;
	exec?: (prompt: string) => string;
	evidencePath?: string;
	rawResponseDir?: string;
};

type CodexStructuredAttempt = {
	attempt: number;
	status: "PASS" | "FAIL";
	failureClass?: "SEMANTIC_VALIDATION";
	details?: string;
};

export async function invokeCodexStructured<T, U = T>(
	request: CodexStructuredRequest<T, U>,
): Promise<U> {
	const maxAttempts = request.maxAttempts ?? request.llm.max_attempts;
	const attempts: CodexStructuredAttempt[] = [];
	let lastValidationError: string | undefined;

	const runPrompt = (prompt: string, attempt: number): string =>
		request.exec
			? request.exec(prompt)
			: runCodexExec(request.llm, prompt, {
					stage: request.name,
					attempt,
					logPath: request.logPath,
					search: request.search,
				});

	const persist = (): void => {
		if (!request.evidencePath) return;
		fs.outputJsonSync(
			request.evidencePath,
			{
				schemaVersion: "structured_llm_attempts_v1",
				name: request.name,
				attempts,
			},
			{ spaces: 2 },
		);
	};

	const logValidation = (
		attempt: number,
		status: "PASS" | "FAIL",
		validationErrors: string[],
		output: string,
	): void =>
		appendCodexLog(request.logPath, {
			event: "validation",
			stage: request.name,
			attempt,
			status,
			endedAt: new Date().toISOString(),
			validationErrors,
			output: redactLlmEvidence(output),
		});

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const text = runPrompt(
			codexPrompt(
				request.messages(attempt, lastValidationError),
				request.llm.json_only_instruction,
			),
			attempt,
		);
		if (request.rawResponseDir) {
			fs.outputJsonSync(
				path.join(request.rawResponseDir, `attempt-${attempt}.json`),
				{
					schemaVersion: "structured_llm_raw_response_v1",
					name: request.name,
					attempt,
					text: redactLlmEvidence(text),
				},
				{ spaces: 2 },
			);
		}
		let validated: U;
		try {
			const value = parseLlmJson(text, request.schema);
			validated = request.validate
				? request.validate(value)
				: (value as unknown as U);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const isZod = error instanceof z.ZodError;
			lastValidationError = isZod ? formatZodIssuesForRetry(error) : message;
			const validationErrors = isZod
				? lastValidationError.split("\n")
				: message.split("; ");
			attempts.push({
				attempt,
				status: "FAIL",
				failureClass: "SEMANTIC_VALIDATION",
				details: redactLlmEvidence(message).slice(0, 500),
			});
			persist();
			logValidation(attempt, "FAIL", validationErrors, text);
			continue;
		}
		attempts.push({ attempt, status: "PASS" });
		persist();
		logValidation(attempt, "PASS", [], text);
		return validated;
	}

	throw new Error(
		`STRUCTURED_OUTPUT_VALIDATION_EXHAUSTED: ${request.name}: ${lastValidationError ?? "codex attempts exhausted"}`,
	);
}
