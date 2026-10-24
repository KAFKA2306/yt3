import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ExperienceHumanReviewScoresSchema } from "./human_review.js";
import { CANONICAL_EXPERIENCE_SCENE_IDS } from "./schema.js";

const CandidateIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const RunIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const LicenseSchema = z
	.object({
		spdx: z.string().trim().min(1),
		ref: z.string().trim().min(1),
		source_url: z.url(),
	})
	.strict();

const ComponentSchema = z
	.object({
		name: z.string().trim().min(1),
		kind: z.enum(["code", "model_weights"]),
		license: LicenseSchema.nullable(),
	})
	.strict();

const CommercialUsePolicySchema = z
	.object({
		permitted_spdx: z.array(z.string().trim().min(1)).min(1),
		restricted_spdx: z.array(z.string().trim().min(1)).min(1),
	})
	.strict();

const BenchmarkEvidenceSchema = z
	.object({
		run_id: RunIdSchema,
		manifest_path: z.string().min(1),
		summary_path: z.string().min(1),
		review_report_path: z.string().min(1),
		manifest_sha256: Sha256Schema,
		summary_sha256: Sha256Schema,
		review_report_sha256: Sha256Schema,
	})
	.strict();

const AdoptionDecisionSchema = z.enum([
	"ADOPT_CORE",
	"ADOPT_OPTIONAL",
	"BENCHMARK_ONLY",
	"REJECT",
	"BLOCKED_RUNTIME",
	"BLOCKED_QUALITY",
]);

export const ExperienceOssCandidateSchema = z
	.object({
		candidate_id: CandidateIdSchema,
		display_name: z.string().trim().min(1),
		quality_target: z.string().trim().min(1),
		benchmark_priority: z.enum(["CORE", "BENCHMARK", "SIDECAR", "OPTIONAL"]),
		components: z.array(ComponentSchema).min(1),
		adoption_decision: AdoptionDecisionSchema.nullable(),
		benchmark_evidence: BenchmarkEvidenceSchema.nullable(),
	})
	.strict();

type ExperienceOssCandidate = z.infer<typeof ExperienceOssCandidateSchema>;
type Component = z.infer<typeof ComponentSchema>;
type CommercialUsePolicy = z.infer<typeof CommercialUsePolicySchema>;
type BenchmarkEvidence = z.infer<typeof BenchmarkEvidenceSchema>;

function commercialUse(
	component: Component,
	policy: CommercialUsePolicy,
): "PERMITTED" | "RESTRICTED" | "UNKNOWN" | "UNVERIFIED" {
	if (component.license === null) return "UNVERIFIED";
	if (policy.permitted_spdx.includes(component.license.spdx))
		return "PERMITTED";
	if (policy.restricted_spdx.includes(component.license.spdx))
		return "RESTRICTED";
	return "UNKNOWN";
}

function licenseGate(
	components: readonly Component[],
	policy: CommercialUsePolicy,
): "CLEARED" | "BLOCKED_LICENSE" {
	return components.every(
		(component) => commercialUse(component, policy) === "PERMITTED",
	)
		? "CLEARED"
		: "BLOCKED_LICENSE";
}

export const ExperienceOssCandidateRegistrySchema = z
	.object({
		schema_version: z.literal(3),
		channel: z.literal("byosan_money"),
		selection_policy: z.literal("measured_evidence_only"),
		commercial_use_policy: CommercialUsePolicySchema,
		candidates: z.array(ExperienceOssCandidateSchema).min(1),
	})
	.strict()
	.superRefine((registry, context) => {
		const policy = registry.commercial_use_policy;
		for (const spdx of policy.restricted_spdx) {
			if (policy.permitted_spdx.includes(spdx)) {
				context.addIssue({
					code: "custom",
					path: ["commercial_use_policy", "restricted_spdx"],
					message: `${spdx} cannot be both permitted and restricted`,
				});
			}
		}
		const seen = new Set<string>();
		for (const [index, candidate] of registry.candidates.entries()) {
			if (seen.has(candidate.candidate_id)) {
				context.addIssue({
					code: "custom",
					path: ["candidates", index, "candidate_id"],
					message: `duplicate candidate id: ${candidate.candidate_id}`,
				});
			}
			seen.add(candidate.candidate_id);
			if (
				!candidate.components.some((component) => component.kind === "code")
			) {
				context.addIssue({
					code: "custom",
					path: ["candidates", index, "components"],
					message: "every candidate requires a code component",
				});
			}
			if (
				candidate.adoption_decision !== null &&
				licenseGate(candidate.components, policy) !== "CLEARED"
			) {
				context.addIssue({
					code: "custom",
					path: ["candidates", index, "adoption_decision"],
					message: "adoption decisions require a CLEARED license gate",
				});
			}
			if (
				candidate.adoption_decision !== null &&
				candidate.benchmark_evidence === null
			) {
				context.addIssue({
					code: "custom",
					path: ["candidates", index, "benchmark_evidence"],
					message: "adoption decisions require linked benchmark evidence",
				});
			}
			if (
				candidate.adoption_decision === "ADOPT_CORE" &&
				candidate.benchmark_priority !== "CORE"
			) {
				context.addIssue({
					code: "custom",
					path: ["candidates", index, "benchmark_priority"],
					message: "ADOPT_CORE candidates must have CORE benchmark priority",
				});
			}
			if (
				candidate.adoption_decision === "ADOPT_OPTIONAL" &&
				candidate.benchmark_priority === "CORE"
			) {
				context.addIssue({
					code: "custom",
					path: ["candidates", index, "benchmark_priority"],
					message: "CORE candidates cannot be classified as ADOPT_OPTIONAL",
				});
			}
			const evidence = candidate.benchmark_evidence;
			if (!evidence) continue;
			const prefix = `artifacts/benchmarks/experience-os/${evidence.run_id}`;
			const expectedPaths = {
				manifest_path: `${prefix}/manifest.json`,
				summary_path: `${prefix}/summary.json`,
				review_report_path: `${prefix}/review.json`,
			};
			for (const [field, expected] of Object.entries(expectedPaths)) {
				if (evidence[field as keyof typeof expectedPaths] !== expected) {
					context.addIssue({
						code: "custom",
						path: ["candidates", index, "benchmark_evidence", field],
						message: `evidence path must be ${expected}`,
					});
				}
			}
		}
	});

const BenchmarkManifestSchema = z
	.object({
		schema_version: z.literal(1),
		status: z.literal("COMPLETE"),
		decision: z.literal("BENCHMARK_ONLY"),
		run_id: RunIdSchema,
		engines: z
			.object({
				candidate: z.object({ id: CandidateIdSchema }).passthrough(),
			})
			.passthrough(),
	})
	.passthrough();

const BenchmarkSummarySchema = z
	.object({
		schema_version: z.literal(1),
		decision: z.literal("BENCHMARK_ONLY"),
		quality_evaluation_status: z.enum(["HUMAN_REVIEWED", "UNMEASURED"]),
		scenes: z
			.array(
				z
					.object({ scene_id: z.enum(CANONICAL_EXPERIENCE_SCENE_IDS) })
					.passthrough(),
			)
			.length(CANONICAL_EXPERIENCE_SCENE_IDS.length),
	})
	.passthrough();

const HumanReviewEvidenceSchema = z
	.object({
		schema_version: z.literal(1),
		status: z.literal("HUMAN_REVIEW_REPORTED"),
		reviewer_identity_status: z.literal("SELF_REPORTED"),
		rubric_version: z.literal(1),
		benchmark_run_id: RunIdSchema,
		reviewer: z.string().trim().min(1),
		reviewed_at: z.string().datetime(),
		scenes: z
			.array(
				z
					.object({
						scene_id: z.enum(CANONICAL_EXPERIENCE_SCENE_IDS),
						baseline: ExperienceHumanReviewScoresSchema,
						motion_canvas: ExperienceHumanReviewScoresSchema,
						quality_delta: z
							.object({
								visual_quality_delta: z.number().finite(),
								comprehension_delta: z.number().finite(),
								identity_consistency_delta: z.number().finite(),
								entertainment_delta: z.number().finite(),
								character_cuteness_delta: z.number().finite(),
								enjoyment_delta: z.number().finite(),
							})
							.strict(),
					})
					.passthrough(),
			)
			.length(CANONICAL_EXPERIENCE_SCENE_IDS.length),
	})
	.passthrough();

function isWithin(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return (
		relative !== "" &&
		!relative.startsWith(`..${path.sep}`) &&
		relative !== ".." &&
		!path.isAbsolute(relative)
	);
}

async function readEvidenceArtifact(
	root: string,
	evidence: BenchmarkEvidence,
	artifact: "manifest" | "summary" | "review_report",
): Promise<unknown> {
	const filePath = evidence[`${artifact}_path`];
	const expectedHash = evidence[`${artifact}_sha256`];
	const evidenceRoot = path.resolve(root, "artifacts/benchmarks/experience-os");
	const runDirectory = path.resolve(evidenceRoot, evidence.run_id);
	const absoluteFilePath = path.resolve(root, filePath);
	const realRoot = await realpath(path.resolve(root));
	const realEvidenceRoot = await realpath(evidenceRoot);
	const realRunDirectory = await realpath(runDirectory);
	const realFilePath = await realpath(absoluteFilePath);
	if (
		!isWithin(realRoot, realEvidenceRoot) ||
		!isWithin(realEvidenceRoot, realRunDirectory) ||
		!isWithin(realRunDirectory, realFilePath)
	) {
		throw new Error(
			`${artifact} evidence resolves outside its canonical run directory`,
		);
	}
	const bytes = await readFile(realFilePath);
	const actualHash = createHash("sha256").update(bytes).digest("hex");
	if (actualHash !== expectedHash) {
		throw new Error(`${artifact} hash mismatch for run ${evidence.run_id}`);
	}
	return JSON.parse(bytes.toString("utf8"));
}

async function auditCandidateEvidence(
	candidate: ExperienceOssCandidate,
	root: string,
): Promise<void> {
	const evidence = candidate.benchmark_evidence;
	if (!evidence) return;
	const [manifestInput, summaryInput, reviewInput] = await Promise.all([
		readEvidenceArtifact(root, evidence, "manifest"),
		readEvidenceArtifact(root, evidence, "summary"),
		readEvidenceArtifact(root, evidence, "review_report"),
	]);
	const manifest = BenchmarkManifestSchema.parse(manifestInput);
	const summary = BenchmarkSummarySchema.parse(summaryInput);
	const review = HumanReviewEvidenceSchema.parse(reviewInput);
	if (manifest.run_id !== evidence.run_id) {
		throw new Error(
			"benchmark manifest run id does not match registry evidence",
		);
	}
	if (manifest.engines.candidate.id !== candidate.candidate_id) {
		throw new Error(
			"benchmark manifest candidate does not match registry candidate",
		);
	}
	if (review.benchmark_run_id !== evidence.run_id) {
		throw new Error("human review run id does not match benchmark evidence");
	}
	if (
		review.scenes.length !== summary.scenes.length ||
		review.scenes.some(
			(scene, index) => scene.scene_id !== summary.scenes[index]?.scene_id,
		)
	) {
		throw new Error("human review scenes do not match benchmark summary");
	}
	if (
		summary.scenes.some(
			(scene, index) =>
				scene.scene_id !== CANONICAL_EXPERIENCE_SCENE_IDS[index],
		)
	) {
		throw new Error("benchmark summary is not in canonical scene order");
	}
	if (
		(candidate.candidate_id === "real-esrgan" ||
			candidate.candidate_id === "video-depth-anything") &&
		candidate.adoption_decision?.startsWith("ADOPT_")
	) {
		const meanVisualQualityDelta =
			review.scenes.reduce(
				(total, scene) => total + scene.quality_delta.visual_quality_delta,
				0,
			) / review.scenes.length;
		if (meanVisualQualityDelta <= 0) {
			throw new Error(
				`${candidate.candidate_id} adoption requires a positive mean visual quality delta`,
			);
		}
	}
}

export async function auditExperienceOssCandidateRegistry(
	input: unknown,
	root = process.cwd(),
) {
	const registry = ExperienceOssCandidateRegistrySchema.parse(input);
	for (const candidate of registry.candidates) {
		await auditCandidateEvidence(candidate, root);
	}
	const candidates = registry.candidates.map((candidate) => {
		const gate = licenseGate(
			candidate.components,
			registry.commercial_use_policy,
		);
		return {
			candidate_id: candidate.candidate_id,
			benchmark_priority: candidate.benchmark_priority,
			license_gate: gate,
			components: candidate.components.map((component) => ({
				name: component.name,
				kind: component.kind,
				commercial_use: commercialUse(
					component,
					registry.commercial_use_policy,
				),
			})),
			decision:
				candidate.adoption_decision ??
				(gate === "BLOCKED_LICENSE" ? "BLOCKED_LICENSE" : "PENDING_BENCHMARK"),
			benchmark_run_id: candidate.benchmark_evidence?.run_id ?? null,
		};
	});
	return {
		status: "PASS" as const,
		channel: registry.channel,
		selection_policy: registry.selection_policy,
		candidate_count: candidates.length,
		cleared_candidate_count: candidates.filter(
			(candidate) => candidate.license_gate === "CLEARED",
		).length,
		adopted_candidate_count: candidates.filter((candidate) =>
			candidate.decision.startsWith("ADOPT_"),
		).length,
		candidates,
		decision_boundary:
			"PASS verifies registry rules, linked artifact integrity, and license gates derived from declared components; license declarations cite pinned primary sources and are not legal advice or proof of production suitability.",
	};
}
