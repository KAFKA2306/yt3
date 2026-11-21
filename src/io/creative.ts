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
	fallbacks: z
		.object({
			title: z.array(ModelRouteSchema).default([]),
			draft: z.array(ModelRouteSchema).default([]),
		})
		.optional(),
});

export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export type CreativeKind = "title" | "draft";
export type CreativeFailoverAttempt = {
	provider: string;
	model: string;
	error: string;
};
export type CreativeReceipt = (
	| AgyReceipt
	| {
			provider: "codex";
			model: string;
			reasoning_effort: string;
			conversation_id?: undefined;
			usage?: undefined;
	  }
) & {
	failover_attempts?: CreativeFailoverAttempt[];
};

function routeKey(route: ModelRoute): string {
	return route.provider === "agy"
		? `agy:${route.model}`
		: `codex:${route.model}:${route.reasoning_effort}`;
}

export function routeChainFor(kind: CreativeKind): ModelRoute[] {
	const file = path.join(ROOT, "config/creative_authoring.yaml");
	const config = CreativeConfigSchema.parse(
		yaml.load(fs.readFileSync(file, "utf8")),
	);
	const chain: ModelRoute[] = [];
	const seen = new Set<string>();
	const pushUnique = (r: ModelRoute) => {
		const k = routeKey(r);
		if (seen.has(k)) return;
		seen.add(k);
		chain.push(r);
	};

	const override =
		process.env[`YT3_CREATIVE_${kind.toUpperCase()}_ROUTE`]?.trim();
	if (override) {
		const [provider, model, reasoningEffort, ...extra] = override.split(":");
		if (extra.length > 0) {
			throw new Error(`Invalid creative route override for ${kind}`);
		}
		pushUnique(
			ModelRouteSchema.parse(
				provider === "agy"
					? { provider, model }
					: { provider, model, reasoning_effort: reasoningEffort },
			),
		);
	}
	pushUnique(config.routes[kind]);
	if (process.env.YT3_CREATIVE_NO_FALLBACK !== "1") {
		for (const fb of config.fallbacks?.[kind] ?? []) {
			pushUnique(fb);
		}
	}
	return chain;
}

export function isFailoverEligibleError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	return /429|rate.?limit|quota|capacity|exhausted|overloaded|usage.?limit|temporar|timeout|timed.?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|502|503|504|ENOENT|exited\s+\d+|empty response|did not write its final response/i.test(
		message,
	);
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
		const outputPath = path.join(tempDir, "last-message.json");
		const schema = z.toJSONSchema(input.jsonSchema ?? input.schema);
		delete schema.$schema;
		const jsonSchema = JSON.stringify(schema);
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
				"-o",
				outputPath,
				"-",
			],
			{
				cwd: tempDir,
				input: [
					input.prompt,
					"最終応答は次のJSON Schemaに適合するJSONだけにしてください。全必須項目を含め、任意項目はスキーマどおりに扱います。",
					`[JSON_SCHEMA]\n${jsonSchema}`,
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
	const routes = routeChainFor(input.kind);
	const failures: CreativeFailoverAttempt[] = [];
	let lastError: unknown;

	for (let i = 0; i < routes.length; i++) {
		const route = routes[i];
		if (!route) continue;
		try {
			const res =
				route.provider === "codex"
					? invokeCodexStructured(input, route)
					: invokeAgyStructured({
							name: input.name,
							prompt: input.prompt,
							schema: input.schema,
							jsonSchema: input.jsonSchema,
							model: route.model,
						});
			if (failures.length > 0) {
				res.receipt = { ...res.receipt, failover_attempts: failures };
			}
			return res;
		} catch (error) {
			lastError = error;
			const msg = error instanceof Error ? error.message : String(error);
			const next = routes[i + 1];
			if (!next || !isFailoverEligibleError(error)) {
				throw error;
			}
			failures.push({
				provider: route.provider,
				model: route.model,
				error: msg.slice(0, 300),
			});
			console.warn(
				`[CREATIVE:FAILOVER] name=${input.name} from=${routeKey(route)} to=${routeKey(next)} reason=${msg.slice(0, 180)}`,
			);
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error(`All creative routes failed for ${input.name}`);
}
