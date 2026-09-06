import { createHash } from "node:crypto";
import { z } from "zod";

export const ByosanActiveProbeTypeSchema = z.enum([
	"git_diff",
	"document_diff",
	"authorized_api",
	"tokenizer_fingerprint",
]);

export const ByosanActiveProbeStatusSchema = z.enum(["VERIFIED", "UNVERIFIED"]);

export const ByosanActiveProbeEvidenceSchema = z.object({
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	probeType: ByosanActiveProbeTypeSchema,
	status: ByosanActiveProbeStatusSchema,
	target: z.string().min(3).max(500),
	executedAt: z.string().datetime().optional(),
	requestOrInputFingerprint: z.string().min(8),
	observedResult: z.string().min(3).max(4000).optional(),
	reproducibility: z.string().min(8).max(1000),
	sourceIds: z.array(z.string().min(1)).min(1),
	limitations: z.array(z.string().min(3).max(500)).min(1).max(10),
	authorization: z.object({
		required: z.boolean(),
		confirmed: z.boolean(),
		paid: z.boolean(),
	}),
	conclusionPolicy: z.literal("observation_only"),
});

export type ByosanActiveProbeEvidence = z.infer<
	typeof ByosanActiveProbeEvidenceSchema
>;

export type ActiveProbeIssue = {
	code: string;
	details: string;
};

const secretPatterns = [
	/\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
	/\bsk-[A-Za-z0-9_-]{12,}\b/,
	/\bAIza[A-Za-z0-9_-]{20,}\b/,
	/(api[_-]?key|authorization|password)\s*[:=]\s*[^\s,;]+/i,
];

export function fingerprintProbeInput(value: unknown): string {
	const serialized =
		typeof value === "string" ? value : JSON.stringify(value, null, 0);
	return createHash("sha256").update(serialized).digest("hex");
}

export function tokenizerFingerprint(
	cases: Array<{ input: string; tokenCount: number }>,
): string {
	const normalized = [...cases]
		.map((item) => ({
			input: item.input.normalize("NFKC"),
			tokenCount: item.tokenCount,
		}))
		.sort((left, right) => left.input.localeCompare(right.input));
	return fingerprintProbeInput(normalized);
}

export function summarizeTextDiff(
	before: string,
	after: string,
): {
	beforeHash: string;
	afterHash: string;
	addedLines: string[];
	removedLines: string[];
} {
	const beforeLines = before.split(/\r?\n/);
	const afterLines = after.split(/\r?\n/);
	const beforeSet = new Set(beforeLines);
	const afterSet = new Set(afterLines);
	return {
		beforeHash: fingerprintProbeInput(before),
		afterHash: fingerprintProbeInput(after),
		addedLines: afterLines.filter((line) => !beforeSet.has(line)),
		removedLines: beforeLines.filter((line) => !afterSet.has(line)),
	};
}

export function auditByosanActiveProbeEvidence(
	input: ByosanActiveProbeEvidence,
): ActiveProbeIssue[] {
	const evidence = ByosanActiveProbeEvidenceSchema.parse(input);
	const issues: ActiveProbeIssue[] = [];
	if (evidence.status === "VERIFIED") {
		if (!evidence.executedAt) {
			issues.push({
				code: "verified_probe_execution_time_missing",
				details: evidence.id,
			});
		}
		if (!evidence.observedResult) {
			issues.push({
				code: "verified_probe_observation_missing",
				details: evidence.id,
			});
		}
	}
	if (
		evidence.probeType === "authorized_api" &&
		(!evidence.authorization.required || !evidence.authorization.confirmed)
	) {
		issues.push({
			code: "api_probe_authorization_missing",
			details: evidence.id,
		});
	}
	if (
		secretPatterns.some((pattern) =>
			pattern.test(
				`${evidence.target}\n${evidence.observedResult ?? ""}\n${evidence.reproducibility}`,
			),
		)
	) {
		issues.push({
			code: "probe_artifact_contains_secret_like_material",
			details: evidence.id,
		});
	}
	return issues;
}
