import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	ExperienceRendererMetricsSchema,
	buildRendererMetrics,
} from "../src/domain/experience/audit.js";
import {
	ExperienceHumanReviewSchema,
	auditExperienceHumanReview,
	buildExperienceHumanReviewTemplate,
} from "../src/domain/experience/human_review.js";
import { CANONICAL_EXPERIENCE_SCENE_IDS } from "../src/domain/experience/schema.js";
import {
	auditExperienceHumanReviewRun,
	prepareExperienceHumanReviewRun,
} from "../src/scripts/experience_review.js";

const dimensions = [
	"visual_quality",
	"comprehension",
	"identity_consistency",
	"entertainment",
	"character_cuteness",
	"enjoyment",
] as const;

function benchmarkInput() {
	return {
		benchmark_run_id: "2026-09-27T00-00-00-000Z",
		scenes: CANONICAL_EXPERIENCE_SCENE_IDS.map((scene_id, index) => ({
			scene_id,
			baseline_video_path: `scenes/${scene_id}/baseline/render.mp4`,
			baseline_output_sha256: String(index + 1).repeat(64),
			motion_canvas_video_path: `scenes/${scene_id}/motion-canvas/render.mp4`,
			motion_canvas_output_sha256: String(index + 5).repeat(64),
		})),
	};
}

function scores(value: number) {
	return Object.fromEntries(dimensions.map((dimension) => [dimension, value]));
}

function completedReview() {
	const template = buildExperienceHumanReviewTemplate(benchmarkInput());
	return {
		...template,
		reviewer: "reviewer-1",
		reviewed_at: "2026-09-27T00:10:00.000Z",
		scenes: template.scenes.map((scene) => ({
			...scene,
			baseline: scores(2),
			motion_canvas: scores(5),
		})),
	};
}

describe("Experience human review", () => {
	test("creates a canonical template with blank reviewer and scores", () => {
		const template = buildExperienceHumanReviewTemplate(benchmarkInput());
		expect(template.reviewer).toBe("");
		expect(template.reviewed_at).toBe("");
		expect(template.rubric.rating_scale).toContain("1=very weak");
		expect(template.scenes.map((scene) => scene.scene_id)).toEqual(
			CANONICAL_EXPERIENCE_SCENE_IDS,
		);
		expect(template.scenes[0]?.baseline).toEqual({
			visual_quality: null,
			comprehension: null,
			identity_consistency: null,
			entertainment: null,
			character_cuteness: null,
			enjoyment: null,
		});
	});

	test("computes separate per-scene deltas without an aggregate score", () => {
		const report = auditExperienceHumanReview(
			completedReview(),
			benchmarkInput(),
		);
		expect(report.status).toBe("HUMAN_REVIEW_REPORTED");
		expect(report.reviewer_identity_status).toBe("SELF_REPORTED");
		expect(report.scenes).toHaveLength(5);
		expect(report.scenes[0]?.quality_delta).toEqual({
			visual_quality_delta: 3,
			comprehension_delta: 3,
			identity_consistency_delta: 3,
			entertainment_delta: 3,
			character_cuteness_delta: 3,
			enjoyment_delta: 3,
		});
		expect(report).not.toHaveProperty("overall_quality_score");
	});

	test("rejects missing scenes, bad ordering, absent reviewer, and out-of-range scores", () => {
		const review = completedReview();
		expect(
			ExperienceHumanReviewSchema.safeParse({
				...review,
				scenes: review.scenes.slice(1),
			}).success,
		).toBe(false);
		expect(
			ExperienceHumanReviewSchema.safeParse({
				...review,
				scenes: [review.scenes[1], review.scenes[0], ...review.scenes.slice(2)],
			}).success,
		).toBe(false);
		expect(
			ExperienceHumanReviewSchema.safeParse({ ...review, reviewer: " " })
				.success,
		).toBe(false);
		expect(
			ExperienceHumanReviewSchema.safeParse({
				...review,
				scenes: review.scenes.map((scene, index) =>
					index === 0
						? {
								...scene,
								baseline: { ...scene.baseline, visual_quality: 6 },
							}
						: scene,
				),
			}).success,
		).toBe(false);
	});

	test("binds the review to the exact run and rendered artifact hashes", () => {
		const review = completedReview();
		expect(() =>
			auditExperienceHumanReview(review, {
				...benchmarkInput(),
				benchmark_run_id: "different-run",
			}),
		).toThrow("benchmark run does not match");
		expect(() =>
			auditExperienceHumanReview(
				{
					...review,
					scenes: review.scenes.map((scene, index) =>
						index === 0
							? { ...scene, baseline_output_sha256: "f".repeat(64) }
							: scene,
					),
				},
				benchmarkInput(),
			),
		).toThrow("artifact hash does not match");
	});

	test("prepares and records a review against measured files without overwriting outputs", async () => {
		const temporary = await mkdtemp(path.join(tmpdir(), "yt3-human-review-"));
		const runDirectory = path.join(temporary, "run-1");
		const reviewTemplatePath = path.join(temporary, "review-template.json");
		const submittedReviewPath = path.join(temporary, "submitted-review.json");
		const reportPath = path.join(temporary, "review-report.json");
		try {
			await mkdir(runDirectory, { recursive: true });
			await writeFile(
				path.join(runDirectory, "manifest.json"),
				JSON.stringify({
					schema_version: 1,
					status: "COMPLETE",
					decision: "BENCHMARK_ONLY",
					run_id: "run-1",
				}),
			);
			for (const scene_id of CANONICAL_EXPERIENCE_SCENE_IDS) {
				for (const engine of ["remotion-existing", "motion-canvas"] as const) {
					const engineDirectory =
						engine === "remotion-existing" ? "baseline" : "motion-canvas";
					const outputDirectory = path.join(
						runDirectory,
						"scenes",
						scene_id,
						engineDirectory,
					);
					await mkdir(outputDirectory, { recursive: true });
					const videoBytes = Buffer.from(scene_id + engine);
					const outputPath = path.join(outputDirectory, "render.mp4");
					await writeFile(outputPath, videoBytes);
					const metrics = buildRendererMetrics({
						engine,
						scene_id,
						started_at: "2026-09-27T00:00:00.000Z",
						finished_at: "2026-09-27T00:00:01.000Z",
						output_bytes: videoBytes.length,
						output_sha256: createHash("sha256")
							.update(videoBytes)
							.digest("hex"),
					});
					expect(
						ExperienceRendererMetricsSchema.safeParse(metrics).success,
					).toBe(true);
					await writeFile(
						path.join(outputDirectory, "metrics.json"),
						JSON.stringify(metrics),
					);
				}
			}

			const template = await prepareExperienceHumanReviewRun(
				runDirectory,
				reviewTemplatePath,
			);
			const filledReview = {
				...template,
				reviewer: "reviewer-1",
				reviewed_at: "2026-09-27T00:10:00.000Z",
				scenes: template.scenes.map((scene) => ({
					...scene,
					baseline: scores(2),
					motion_canvas: scores(4),
				})),
			};
			await writeFile(submittedReviewPath, JSON.stringify(filledReview));

			const report = await auditExperienceHumanReviewRun(
				runDirectory,
				submittedReviewPath,
				reportPath,
			);
			expect(report.status).toBe("HUMAN_REVIEW_REPORTED");
			expect(JSON.parse(await readFile(reportPath, "utf8"))).toEqual(report);
			await expect(
				auditExperienceHumanReviewRun(
					runDirectory,
					submittedReviewPath,
					reportPath,
				),
			).rejects.toThrow();

			const firstVideo = path.join(
				runDirectory,
				"scenes",
				CANONICAL_EXPERIENCE_SCENE_IDS[0],
				"baseline",
				"render.mp4",
			);
			await writeFile(firstVideo, "changed after benchmark");
			await expect(
				auditExperienceHumanReviewRun(
					runDirectory,
					submittedReviewPath,
					path.join(temporary, "tampered-report.json"),
				),
			).rejects.toThrow("artifact bytes do not match");
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});
});
