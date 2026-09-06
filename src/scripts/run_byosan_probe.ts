import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	ByosanActiveProbeEvidenceSchema,
	auditByosanActiveProbeEvidence,
	fingerprintProbeInput,
	summarizeTextDiff,
	tokenizerFingerprint,
} from "../domain/byosan/active_probe.js";

const BaseRequestSchema = z.object({
	schemaVersion: z.literal("byosan_probe_request_v1"),
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	sourceIds: z.array(z.string().min(1)).min(1),
	limitations: z.array(z.string().min(3)).min(1),
	paid: z.boolean().default(false),
});

const ProbeRequestSchema = z.discriminatedUnion("probeType", [
	BaseRequestSchema.extend({
		probeType: z.literal("git_diff"),
		repoPath: z.string().min(1),
		baseRef: z.string().min(1),
		headRef: z.string().min(1),
	}),
	BaseRequestSchema.extend({
		probeType: z.literal("document_diff"),
		beforePath: z.string().min(1),
		afterPath: z.string().min(1),
	}),
	BaseRequestSchema.extend({
		probeType: z.literal("authorized_api"),
		url: z.string().url(),
		method: z.enum(["GET", "POST"]).default("GET"),
		body: z.unknown().optional(),
		bearerTokenEnv: z.string().regex(/^[A-Z0-9_]+$/).optional(),
	}),
	BaseRequestSchema.extend({
		probeType: z.literal("tokenizer_fingerprint"),
		target: z.string().min(3),
		cases: z
			.array(
				z.object({
					input: z.string(),
					tokenCount: z.number().int().min(0),
				}),
			)
			.min(1),
	}),
]);

function redact(value: string): string {
	return value
		.replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
		.replaceAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]")
		.replaceAll(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_KEY]");
}

function assertPaidAuthorization(paid: boolean): void {
	if (process.env.BYOSAN_PROBE_AUTHORIZED !== "true") {
		throw new Error(
			"ACTIVE_PROBE_BLOCKED: set BYOSAN_PROBE_AUTHORIZED=true after confirming target authorization",
		);
	}
	if (paid && process.env.BYOSAN_PROBE_ALLOW_PAID !== "true") {
		throw new Error(
			"ACTIVE_PROBE_BLOCKED: paid probe requires BYOSAN_PROBE_ALLOW_PAID=true",
		);
	}
}

async function execute(request: z.infer<typeof ProbeRequestSchema>) {
	if (request.probeType === "git_diff") {
		const result = spawnSync(
			"git",
			["diff", "--no-ext-diff", request.baseRef, request.headRef, "--"],
			{
				cwd: path.resolve(request.repoPath),
				encoding: "utf8",
				maxBuffer: 4 * 1024 * 1024,
			},
		);
		if (result.status !== 0) {
			throw new Error(
				`ACTIVE_PROBE_GIT_DIFF_FAILED: ${result.stderr.trim()}`,
			);
		}
		const observation = redact(result.stdout).slice(0, 4000);
		return {
			target: `${path.resolve(request.repoPath)}:${request.baseRef}..${request.headRef}`,
			fingerprint: fingerprintProbeInput({
				repoPath: path.resolve(request.repoPath),
				baseRef: request.baseRef,
				headRef: request.headRef,
			}),
			observation: observation || "No textual diff between requested refs.",
			reproducibility: `git diff --no-ext-diff ${request.baseRef} ${request.headRef} --`,
			authorizationRequired: false,
			authorizationConfirmed: true,
		};
	}
	if (request.probeType === "document_diff") {
		const before = fs.readFileSync(path.resolve(request.beforePath), "utf8");
		const after = fs.readFileSync(path.resolve(request.afterPath), "utf8");
		const diff = summarizeTextDiff(before, after);
		return {
			target: `${path.resolve(request.beforePath)} -> ${path.resolve(request.afterPath)}`,
			fingerprint: fingerprintProbeInput({
				beforePath: path.resolve(request.beforePath),
				afterPath: path.resolve(request.afterPath),
				beforeHash: diff.beforeHash,
				afterHash: diff.afterHash,
			}),
			observation: redact(JSON.stringify(diff)).slice(0, 4000),
			reproducibility:
				"Read both named files and compare normalized line membership plus SHA-256 fingerprints.",
			authorizationRequired: false,
			authorizationConfirmed: true,
		};
	}
	if (request.probeType === "tokenizer_fingerprint") {
		return {
			target: request.target,
			fingerprint: fingerprintProbeInput(request.cases),
			observation: `tokenizer_fingerprint=${tokenizerFingerprint(request.cases)} cases=${request.cases.length}`,
			reproducibility:
				"Re-run the same ordered input strings, record integer token counts, normalize NFKC, sort by input, and SHA-256 the resulting pairs.",
			authorizationRequired: false,
			authorizationConfirmed: true,
		};
	}

	assertPaidAuthorization(request.paid);
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (request.bearerTokenEnv) {
		const token = process.env[request.bearerTokenEnv];
		if (!token) {
			throw new Error(
				`ACTIVE_PROBE_AUTH_SECRET_MISSING: ${request.bearerTokenEnv}`,
			);
		}
		headers.authorization = `Bearer ${token}`;
	}
	const response = await fetch(request.url, {
		method: request.method,
		headers,
		...(request.method === "POST"
			? { body: JSON.stringify(request.body ?? {}) }
			: {}),
		signal: AbortSignal.timeout(30_000),
	});
	const raw = await response.text();
	const observation = redact(
		JSON.stringify({
			status: response.status,
			ok: response.ok,
			body: raw.slice(0, 3000),
		}),
	).slice(0, 4000);
	return {
		target: request.url,
		fingerprint: fingerprintProbeInput({
			url: request.url,
			method: request.method,
			body: request.body ?? null,
		}),
		observation,
		reproducibility:
			"Repeat the same authorized HTTP method, URL, and request body under the same account entitlement; credentials are supplied only via environment and are not persisted.",
		authorizationRequired: true,
		authorizationConfirmed: true,
	};
}

async function main() {
	const specPath = process.env.SPEC || process.argv[2];
	if (!specPath) throw new Error("SPEC=<probe request json> is required");
	const request = ProbeRequestSchema.parse(
		await fs.readJson(path.resolve(specPath)),
	);
	const observed = await execute(request);
	const evidence = ByosanActiveProbeEvidenceSchema.parse({
		id: request.id,
		probeType: request.probeType,
		status: "VERIFIED",
		target: observed.target,
		executedAt: new Date().toISOString(),
		requestOrInputFingerprint: observed.fingerprint,
		observedResult: observed.observation,
		reproducibility: observed.reproducibility,
		sourceIds: request.sourceIds,
		limitations: request.limitations,
		authorization: {
			required: observed.authorizationRequired,
			confirmed: observed.authorizationConfirmed,
			paid: request.paid,
		},
		conclusionPolicy: "observation_only",
	});
	const issues = auditByosanActiveProbeEvidence(evidence);
	if (issues.length > 0) {
		throw new Error(
			`ACTIVE_PROBE_EVIDENCE_INVALID: ${issues.map((issue) => issue.code).join(",")}`,
		);
	}
	const outputPath =
		process.env.OUT ||
		path.join(
			path.dirname(path.resolve(specPath)),
			`${request.id}.probe-evidence.json`,
		);
	await fs.outputJson(outputPath, evidence, { spaces: 2 });
	console.log(`ACTIVE_PROBE_VERIFIED=${outputPath}`);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
