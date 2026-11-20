import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import * as yaml from "js-yaml";
import { z } from "zod";
import { type AgyReceipt, invokeAgyStructured } from "./agy.js";
import { ROOT } from "./core.js";

const ModelRouteSchema = z.discriminatedUnion("provider", [
	z.object({ provider: z.literal("agy"), model: z.string().min(1) }),
	z.object({
		provider: z.literal("codex"),
		model: z.string().min(1),
		reasoning_effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
	}),
]);

const CreativeConfigSchema = z.object({
	routes: z.object({ title: ModelRouteSchema, draft: ModelRouteSchema }),
});

type ModelRoute = z.infer<typeof ModelRouteSchema>;
export type CreativeKind = "title" | "draft";
export type CreativeReceipt =
	| AgyReceipt
	| {
			provider: "codex";
			model: string;
			reasoning_effort: string;
			conversation_id?: undefined;
			usage?: undefined;
	  };

function routeFor(kind: CreativeKind): ModelRoute {
	const override =
		process.env[`YT3_CREATIVE_${kind.toUpperCase()}_ROUTE`]?.trim();
	if (override) {
		const [provider, model, reasoningEffort, ...extra] = override.split(":");
		if (extra.length > 0) {
			throw new Error(`Invalid creative route override for ${kind}`);
		}
		return ModelRouteSchema.parse(
			provider === "agy"
				? { provider, model }
				: { provider, model, reasoning_effort: reasoningEffort },
		);
	}
	const file = path.join(ROOT, "config/creative_authoring.yaml");
	const config = CreativeConfigSchema.parse(
		yaml.load(fs.readFileSync(file, "utf8")),
	);
	return config.routes[kind];
}

function invokeCodexStructured<T>(
	input: {
		name: string;
		prompt: string;
		schema: z.ZodType<T>;
		jsonSchema?: z.ZodType;
	},
	route: Extract<ModelRoute, { provider: "codex" }>,
): {
	value: T;
	receipt: CreativeReceipt;
} {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-codex-creative-"));
	try {
		const schemaPath = path.join(tempDir, "schema.json");
		const outputPath = path.join(tempDir, "last-message.json");
		const schema = z.toJSONSchema(input.jsonSchema ?? input.schema);
		delete schema.$schema;
		fs.writeJsonSync(schemaPath, schema);
		const result = spawnSync(
			"codex",
			[
				"exec",
				"--model",
				route.model,
				"-c",
				`model_reasoning_effort="${route.reasoning_effort}"`,
				"-C",
				tempDir,
				"--sandbox",
				"read-only",
				"--ephemeral",
				"--skip-git-repo-check",
				"--ignore-user-config",
				"--output-schema",
				schemaPath,
				"-o",
				outputPath,
				"-",
			],
			{
				cwd: tempDir,
				input: [
					input.prompt,
					"最終応答は指定スキーマに適合するJSONだけにしてください。",
				].join("\n\n"),
				encoding: "utf8",
				timeout: 21 * 60 * 1000,
				maxBuffer: 64 * 1024 * 1024,
			},
		);
		if (result.error) throw result.error;
		if (result.status !== 0) {
			throw new Error(
				`Codex ${input.name} exited ${result.status ?? "without an exit code"}: ${result.stderr.trim().slice(-2000)}`,
			);
		}
		if (!fs.existsSync(outputPath)) {
			throw new Error(`Codex ${input.name} did not write its final response`);
		}
		const raw = fs.readFileSync(outputPath, "utf8").trim();
		if (!raw) throw new Error(`Codex ${input.name} returned an empty response`);
		return {
			value: input.schema.parse(JSON.parse(raw)),
			receipt: {
				provider: "codex",
				model: route.model,
				reasoning_effort: route.reasoning_effort,
			},
		};
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Codex ${input.name} returned invalid JSON`, {
				cause: error,
			});
		}
		throw error;
	} finally {
		fs.removeSync(tempDir);
	}
}

export function invokeCreativeStructured<T>(input: {
	name: string;
	kind: CreativeKind;
	prompt: string;
	schema: z.ZodType<T>;
	jsonSchema?: z.ZodType;
}): { value: T; receipt: CreativeReceipt } {
	const route = routeFor(input.kind);
	if (route.provider === "codex") {
		return invokeCodexStructured(input, route);
	}
	const result = invokeAgyStructured({
		name: input.name,
		prompt: input.prompt,
		schema: input.schema,
		jsonSchema: input.jsonSchema,
		model: route.model,
	});
	return result;
}
