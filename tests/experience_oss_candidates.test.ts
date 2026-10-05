import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	ExperienceOssCandidateRegistrySchema,
	auditExperienceOssCandidateRegistry,
} from "../src/domain/experience/oss_candidate_registry.js";
import { CANONICAL_EXPERIENCE_SCENE_IDS } from "../src/domain/experience/schema.js";

const registryPath = path.join(
	process.cwd(),
	"config/channels/byosan/oss-candidates.json",
);

async function hashFile(filePath: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(filePath))
		.digest("hex");
}

describe("Experience OSS candidate registry", () => {
	test("keeps the first CORE benchmark candidates classified without star data", async () => {
		const registry = JSON.parse(await readFile(registryPath, "utf8"));
		const result = await auditExperienceOssCandidateRegistry(
			registry,
			process.cwd(),
		);

		expect(result).toMatchObject({ status: "PASS", candidate_count: 8 });
		expect(
			registry.candidates
				.filter(
					(candidate: { benchmark_priority: string }) =>
						candidate.benchmark_priority === "CORE",
				)
				.map((candidate: { candidate_id: string }) => candidate.candidate_id),
		).toEqual(["motion-canvas", "birefnet", "liveportrait"]);
		expect(
			registry.candidates.every(
				(candidate: { adoption_decision: string | null }) =>
					candidate.adoption_decision === null,
			),
		).toBe(true);
	});

	test("requires linked benchmark artifacts and reviewed licenses before adoption", () => {
		const result = ExperienceOssCandidateRegistrySchema.safeParse({
			schema_version: 1,
			channel: "byosan_money",
			selection_policy: "measured_evidence_only",
			candidates: [
				{
					candidate_id: "motion-canvas",
					display_name: "Motion Canvas",
					quality_target: "deterministic scene motion",
					benchmark_priority: "CORE",
					evaluation_status: "BENCHMARKED",
					adoption_decision: "ADOPT_CORE",
					code_license_status: "VERIFIED",
					code_license_evidence: {
						version: "3.17.2",
						source_url: "https://example.test/LICENSE",
					},
					model_weight_license_status: "NOT_USED",
					model_weight_license_evidence: null,
					state_reason: "benchmark evidence is required",
					benchmark_evidence: null,
				},
			],
		});

		expect(result.success).toBe(false);
	});

	test("verifies run identity, canonical artifact scope, and content hashes", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "yt3-oss-evidence-"));
		const runId = "test-run-001";
		const runDirectory = path.join(
			root,
			"artifacts/benchmarks/experience-os",
			runId,
		);
		const evidencePaths = {
			manifest_path: `artifacts/benchmarks/experience-os/${runId}/manifest.json`,
			summary_path: `artifacts/benchmarks/experience-os/${runId}/summary.json`,
			review_report_path: `artifacts/benchmarks/experience-os/${runId}/review.json`,
		};
		try {
			await mkdir(runDirectory, { recursive: true });
			const baselineScores = {
				visual_quality: 3,
				comprehension: 3,
				identity_consistency: 3,
				entertainment: 3,
				character_cuteness: 3,
				enjoyment: 3,
			};
			const motionCanvasScores = {
				visual_quality: 4,
				comprehension: 4,
				identity_consistency: 4,
				entertainment: 4,
				character_cuteness: 4,
				enjoyment: 4,
			};
			const reviewScenes = CANONICAL_EXPERIENCE_SCENE_IDS.map((scene_id) => ({
				scene_id,
				baseline: baselineScores,
				motion_canvas: motionCanvasScores,
				quality_delta: {
					visual_quality_delta: 1,
					comprehension_delta: 1,
					identity_consistency_delta: 1,
					entertainment_delta: 1,
					character_cuteness_delta: 1,
					enjoyment_delta: 1,
				},
			}));
			await writeFile(
				path.join(runDirectory, "manifest.json"),
				JSON.stringify({
					schema_version: 1,
					status: "COMPLETE",
					decision: "BENCHMARK_ONLY",
					run_id: runId,
					engines: {
						baseline: { id: "remotion-existing" },
						candidate: { id: "motion-canvas" },
					},
				}),
			);
			await writeFile(
				path.join(runDirectory, "summary.json"),
				JSON.stringify({
					schema_version: 1,
					decision: "BENCHMARK_ONLY",
					quality_evaluation_status: "UNMEASURED",
					scenes: CANONICAL_EXPERIENCE_SCENE_IDS.map((scene_id) => ({
						scene_id,
					})),
				}),
			);
			await writeFile(
				path.join(runDirectory, "review.json"),
				JSON.stringify({
					schema_version: 1,
					status: "HUMAN_REVIEW_REPORTED",
					reviewer_identity_status: "SELF_REPORTED",
					rubric_version: 1,
					benchmark_run_id: runId,
					reviewer: "test reviewer",
					reviewed_at: "2026-01-01T00:00:00.000Z",
					scenes: reviewScenes,
				}),
			);
			const candidate = {
				candidate_id: "motion-canvas",
				display_name: "Motion Canvas",
				quality_target: "deterministic scene motion",
				benchmark_priority: "CORE",
				evaluation_status: "BENCHMARKED",
				adoption_decision: "ADOPT_CORE",
				code_license_status: "VERIFIED",
				code_license_evidence: {
					version: "3.17.2",
					source_url: "https://example.test/LICENSE",
				},
				model_weight_license_status: "NOT_USED",
				model_weight_license_evidence: null,
				state_reason: "measured benchmark and human review passed",
				benchmark_evidence: {
					run_id: runId,
					...evidencePaths,
					manifest_sha256: await hashFile(
						path.join(runDirectory, "manifest.json"),
					),
					summary_sha256: await hashFile(
						path.join(runDirectory, "summary.json"),
					),
					review_report_sha256: await hashFile(
						path.join(runDirectory, "review.json"),
					),
				},
			};
			const registry = {
				schema_version: 1,
				channel: "byosan_money",
				selection_policy: "measured_evidence_only",
				candidates: [candidate],
			};

			expect(
				await auditExperienceOssCandidateRegistry(registry, root),
			).toMatchObject({ status: "PASS", adopted_candidate_count: 1 });

			const tampered = structuredClone(registry);
			tampered.candidates[0].benchmark_evidence.manifest_sha256 = "0".repeat(
				64,
			);
			await expect(
				auditExperienceOssCandidateRegistry(tampered, root),
			).rejects.toThrow("manifest hash mismatch");

			const esrgan = structuredClone(registry);
			const esrganCandidate = esrgan.candidates[0];
			esrganCandidate.candidate_id = "real-esrgan";
			esrganCandidate.display_name = "Real-ESRGAN";
			esrganCandidate.benchmark_priority = "BENCHMARK";
			esrganCandidate.adoption_decision = "ADOPT_OPTIONAL";
			esrganCandidate.state_reason = "negative quality control fixture";
			const manifestPath = path.join(runDirectory, "manifest.json");
			const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
			manifest.engines.candidate.id = "real-esrgan";
			await writeFile(manifestPath, JSON.stringify(manifest));
			const reviewPath = path.join(runDirectory, "review.json");
			const review = JSON.parse(await readFile(reviewPath, "utf8"));
			for (const scene of review.scenes) {
				scene.quality_delta.visual_quality_delta = 0;
			}
			await writeFile(reviewPath, JSON.stringify(review));
			esrganCandidate.benchmark_evidence.manifest_sha256 =
				await hashFile(manifestPath);
			esrganCandidate.benchmark_evidence.review_report_sha256 =
				await hashFile(reviewPath);
			await expect(
				auditExperienceOssCandidateRegistry(esrgan, root),
			).rejects.toThrow("positive mean visual quality delta");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects GitHub-star fields rather than silently using them", async () => {
		const registry = JSON.parse(await readFile(registryPath, "utf8"));
		registry.candidates[0].github_stars = 999999;
		expect(
			ExperienceOssCandidateRegistrySchema.safeParse(registry).success,
		).toBe(false);
	});
});
