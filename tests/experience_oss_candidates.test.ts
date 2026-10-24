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

const MIT_LICENSE = {
	spdx: "MIT",
	ref: "e735a995aa738ca682feb4204a39ee7db7b5d279",
	source_url:
		"https://raw.githubusercontent.com/motion-canvas/motion-canvas/e735a995aa738ca682feb4204a39ee7db7b5d279/LICENSE",
};

function fixtureRegistry(candidate: Record<string, unknown>) {
	return {
		schema_version: 3,
		channel: "byosan_money",
		selection_policy: "measured_evidence_only",
		commercial_use_policy: {
			permitted_spdx: ["MIT", "Apache-2.0"],
			restricted_spdx: ["CC-BY-NC-4.0"],
		},
		candidates: [
			{
				candidate_id: "motion-canvas",
				display_name: "Motion Canvas",
				quality_target: "deterministic scene motion",
				benchmark_priority: "CORE",
				components: [{ name: "code", kind: "code", license: MIT_LICENSE }],
				adoption_decision: null,
				benchmark_evidence: null,
				...candidate,
			},
		],
	};
}

async function hashFile(filePath: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(filePath))
		.digest("hex");
}

describe("Experience OSS candidate registry", () => {
	test("derives license gates from pinned primary-source components", async () => {
		const registry = JSON.parse(await readFile(registryPath, "utf8"));
		const result = await auditExperienceOssCandidateRegistry(
			registry,
			process.cwd(),
		);

		expect(result).toMatchObject({
			status: "PASS",
			candidate_count: 8,
			cleared_candidate_count: 3,
			adopted_candidate_count: 0,
		});
		const byId = Object.fromEntries(
			result.candidates.map((candidate) => [candidate.candidate_id, candidate]),
		);
		expect(byId["motion-canvas"]).toMatchObject({
			license_gate: "CLEARED",
			decision: "PENDING_BENCHMARK",
			components: [{ commercial_use: "PERMITTED" }],
		});
		expect(byId.liveportrait).toMatchObject({
			license_gate: "BLOCKED_LICENSE",
			decision: "BLOCKED_LICENSE",
		});
		expect(byId.liveportrait.components).toContainEqual({
			name: "InsightFace buffalo_l face analysis models (LivePortrait default)",
			kind: "model_weights",
			commercial_use: "RESTRICTED",
		});
		expect(byId.whisperx.components).toContainEqual({
			name: "wav2vec2 alignment models",
			kind: "model_weights",
			commercial_use: "UNVERIFIED",
		});
		expect(
			registry.candidates
				.filter(
					(candidate: { benchmark_priority: string }) =>
						candidate.benchmark_priority === "CORE",
				)
				.map((candidate: { candidate_id: string }) => candidate.candidate_id),
		).toEqual(["motion-canvas", "birefnet", "liveportrait"]);
	});

	test("rejects stored license-gate decisions that are not backed by cleared components", () => {
		const registry = JSON.parse(JSON.stringify(fixtureRegistry({})));
		registry.candidates[0].components[0].license = null;
		registry.candidates[0].adoption_decision = "ADOPT_CORE";

		const result = ExperienceOssCandidateRegistrySchema.safeParse(registry);
		expect(result.success).toBe(false);
		if (result.success) throw new Error("uncleared adoption must be rejected");
		expect(result.error.issues.map((issue) => issue.message)).toContain(
			"adoption decisions require a CLEARED license gate",
		);
	});

	test("rejects stored BLOCKED_LICENSE because the gate is derived", () => {
		const registry = fixtureRegistry({ adoption_decision: "BLOCKED_LICENSE" });
		expect(
			ExperienceOssCandidateRegistrySchema.safeParse(registry).success,
		).toBe(false);
	});

	test("requires a code component and a non-overlapping commercial-use policy", () => {
		const noCode = fixtureRegistry({
			components: [
				{ name: "weights", kind: "model_weights", license: MIT_LICENSE },
			],
		});
		expect(ExperienceOssCandidateRegistrySchema.safeParse(noCode).success).toBe(
			false,
		);

		const overlapping = fixtureRegistry({});
		overlapping.commercial_use_policy.restricted_spdx = ["MIT"];
		expect(
			ExperienceOssCandidateRegistrySchema.safeParse(overlapping).success,
		).toBe(false);
	});

	test("requires linked benchmark artifacts before adoption", () => {
		const result = ExperienceOssCandidateRegistrySchema.safeParse(
			fixtureRegistry({ adoption_decision: "ADOPT_CORE" }),
		);

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
			const registry = fixtureRegistry({
				adoption_decision: "ADOPT_CORE",
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
			});

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
			esrganCandidate.components = [
				{ name: "code", kind: "code", license: MIT_LICENSE },
			];
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
});
