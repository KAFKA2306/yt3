import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

export const AGY_CREATIVE_MODEL = "gemini-4-neon-high";

type AgyEnvelope = {
	status: string;
	response?: string;
	structured_output?: unknown;
	error?: string;
	conversation_id?: string;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		thinking_tokens?: number;
		cache_read_tokens?: number;
		total_tokens?: number;
	};
};

export type AgyReceipt = Pick<AgyEnvelope, "conversation_id" | "usage"> & {
	model: typeof AGY_CREATIVE_MODEL;
};

export function invokeAgyStructured<T>(input: {
	name: string;
	prompt: string;
	schema: z.ZodType<T>;
	jsonSchema?: z.ZodType;
}): { value: T; receipt: AgyReceipt } {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-agy-"));
	try {
		const prompt = [
			input.prompt,
			"出力契約: 指定されたスキーマに合うJSONオブジェクトを一つだけ返す。JSONの前後に説明文、見出し、Markdownを付けない。",
		].join("\n\n");
		const schemaPath = path.join(tempDir, "schema.json");
		const schema = z.toJSONSchema(input.jsonSchema ?? input.schema);
		delete schema.$schema;
		fs.writeJsonSync(schemaPath, schema);
		const result = spawnSync(
			"agy",
			[
				"-p",
				prompt,
				"--model",
				AGY_CREATIVE_MODEL,
				"--output-format",
				"json",
				"--json-schema",
				schemaPath,
				"--print-timeout",
				"20m",
				"--sandbox",
			],
			{
				cwd: tempDir,
				encoding: "utf8",
				timeout: 21 * 60 * 1000,
				maxBuffer: 64 * 1024 * 1024,
			},
		);
		if (result.error) throw result.error;
		if (result.status !== 0) {
			throw new Error(
				`AGY ${input.name} exited ${result.status ?? "without an exit code"}: ${result.stderr.trim().slice(-2000)}`,
			);
		}
		const envelope = JSON.parse(result.stdout) as AgyEnvelope;
		if (envelope.status !== "SUCCESS") {
			throw new Error(
				`AGY ${input.name} status=${envelope.status}: ${(envelope.error ?? result.stderr).trim().slice(-2000)}`,
			);
		}
		if (typeof envelope.response !== "string" || !envelope.response.trim()) {
			throw new Error(`AGY ${input.name} returned an empty response`);
		}
		if (envelope.structured_output === undefined) {
			throw new Error(
				`AGY ${input.name} omitted structured_output: ${envelope.response.slice(0, 600)}`,
			);
		}
		return {
			value: input.schema.parse(envelope.structured_output),
			receipt: {
				model: AGY_CREATIVE_MODEL,
				conversation_id: envelope.conversation_id,
				usage: envelope.usage,
			},
		};
	} finally {
		fs.removeSync(tempDir);
	}
}
