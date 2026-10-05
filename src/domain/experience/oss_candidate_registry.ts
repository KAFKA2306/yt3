import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ExperienceHumanReviewScoresSchema } from "./human_review.js";
import { CANONICAL_EXPERIENCE_SCENE_IDS } from "./schema.js";

const CandidateIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const RunIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const LicenseEvidenceSchema = z
	.object({
		version: z.string().trim().min(1),
		source_url: z.url(),
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

const AdoptionStatusSchema = z.enum([
	"ADOPT_CORE",
	"ADOPT_OPTIONAL",
	"BENCHMARK_ONLY",
	"REJECT",
	"BLOCKED_LICENSE",
	"BLOCKED_RUNTIME",
	"BLOCKED_QUALITY",
]);

export const ExperienceOssCandidateSchema = z
	.object({
		candidate_id: CandidateIdSchema,
		display_name: z.string().trim().min(1),
		quality_target: z.string().trim().min(1),
		benchmark_priority: z.enum(["CORE", "BENCHMARK", "SIDECAR", "OPTIONAL"]),
		evaluation_status: z.enum([
			"READY_FOR_BENCHMARK",
			"BLOCKED_LICENSE",
			"AWAITING_BENCHMARK",
			"BENCHMARKED",
		]),
		adoption_decision: AdoptionStatusSchema.nullable(),
		code_license_status: z.enum(["VERIFIED", "UNVERIFIED"]),
		code_license_evidence: LicenseEvidenceSchema.nullable(),
		model_weight_license_status: z.enum(["VERIFIED", "UNVERIFIED", "NOT_USED"]),
		model_weight_license_evidence: LicenseEvidenceSchema.nullable(),
		state_reason: z.string().trim().min(1),
		benchmark_evidence: BenchmarkEvidenceSchema.nullable(),
	})
	.strict()
	.superRefine((candidate, context) => {
		const hasDecision = candidate.adoption_decision !== null;
		if (
			(candidate.code_license_status === "VERIFIED") !==
			(candidate.code_license_evidence !== null)
		) {
			context.addIssue({
				code: "custom",
				path: ["code_license_evidence"],
				message:
					"verified code-license status requires a versioned source reference",
			});
		}
		if (
			(candidate.model_weight_license_status === "VERIFIED") !==
			(candidate.model_weight_license_evidence !== null)
		) {
			context.addIssue({
				code: "custom",
				path: ["model_weight_license_evidence"],
				message:
					"verified model-weight status requires a versioned source reference",
			});
		}
		if (
			candidate.model_weight_license_status === "NOT_USED" &&
			candidate.model_weight_license_evidence !== null
		) {
			context.addIssue({
				code: "custom",
				path: ["model_weight_license_evidence"],
				message: "NOT_USED model weights cannot have license evidence",
			});
		}
		if (hasDecision && candidate.benchmark_evidence === null) {
			context.addIssue({
				code: "custom",
				path: ["benchmark_evidence"],
				message: "every adoption decision requires linked benchmark evidence",
			});
		}
		if (
			candidate.adoption_decision?.startsWith("ADOPT_") &&
			(candidate.code_license_status !== "VERIFIED" ||
				(candidate.model_weight_license_status !== "VERIFIED" &&
					candidate.model_weight_license_status !== "NOT_USED"))
		) {
			context.addIssue({
				code: "custom",
				path: ["code_license_status"],
				message:
					"adoption requires verified code and model-weight license status",
			});
		}
		if (
			candidate.adoption_decision === "ADOPT_CORE" &&
			candidate.benchmark_priority !== "CORE"
		) {
			context.addIssue({
				code: "custom",
				path: ["benchmark_priority"],
				message: "ADOPT_CORE candidates must have CORE benchmark priority",
			});
		}
		if (
			candidate.adoption_decision === "ADOPT_OPTIONAL" &&
			candidate.benchmark_priority === "CORE"
		) {
			context.addIssue({
				code: "custom",
				path: ["benchmark_priority"],
				message: "CORE candidates cannot be classified as ADOPT_OPTIONAL",
			});
		}
		if (
			candidate.evaluation_status === "BLOCKED_LICENSE" &&
			candidate.code_license_status === "VERIFIED" &&
			candidate.model_weight_license_status !== "UNVERIFIED"
		) {
			context.addIssue({
				code: "custom",
				path: ["evaluation_status"],
				message: "BLOCKED_LICENSE requires an unverified license status",
			});
		}
		if (
			candidate.evaluation_status === "BENCHMARKED" &&
			candidate.benchmark_evidence === null
		) {
			context.addIssue({
				code: "custom",
				path: ["benchmark_evidence"],
				message: "BENCHMARKED candidates require linked benchmark evidence",
			});
		}
		if (hasDecision && candidate.evaluation_status !== "BENCHMARKED") {
			context.addIssue({
				code: "custom",
				path: ["evaluation_status"],
				message: "final decisions require BENCHMARKED evaluation status",
			});
		}
	});

export const ExperienceOssCandidateRegistrySchema = z
	.object({
		schema_version: z.literal(1),
		channel: z.literal("byosan_money"),
		selection_policy: z.literal("measured_evidence_only"),
		candidates: z.array(ExperienceOssCandidateSchema).min(1),
	})
	.strict()
	.superRefine((registry, context) => {
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

type ExperienceOssCandidate = z.infer<typeof ExperienceOssCandidateSchema>;
type BenchmarkEvidence = z.infer<typeof BenchmarkEvidenceSchema>;

const BenchmarkManifestSchema = z
	.object({
		schema_version: z.literal(1),
		status: z.literal("COMPLETE"),
		decision: z.literal("BENCHMARK_ONLY"),
		run_id: RunIdSchema,
		candidate: z.object({ id: CandidateIdSchema }).passthrough(),
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
	if (manifest.candidate.id !== candidate.candidate_id) {
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
	return {
		status: "PASS" as const,
		channel: registry.channel,
		selection_policy: registry.selection_policy,
		candidate_count: registry.candidates.length,
		adopted_candidate_count: registry.candidates.filter((candidate) =>
			candidate.adoption_decision?.startsWith("ADOPT_"),
		).length,
		blocked_candidate_count: registry.candidates.filter((candidate) =>
			candidate.evaluation_status.startsWith("BLOCKED_"),
		).length,
		candidates: registry.candidates.map((candidate) => ({
			candidate_id: candidate.candidate_id,
			benchmark_priority: candidate.benchmark_priority,
			evaluation_status: candidate.evaluation_status,
			adoption_decision: candidate.adoption_decision,
			benchmark_run_id: candidate.benchmark_evidence?.run_id ?? null,
		})),
		decision_boundary:
			"PASS verifies registry rules and linked artifact integrity; it does not independently establish benchmark quality, reviewer identity, license terms, or production suitability.",
	};
}
