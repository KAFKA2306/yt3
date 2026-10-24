import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { MOTION_CANVAS_VERSION } from "../src/domain/episode/motion_canvas_workspace.js";
import { REMOTION_VERSION } from "../src/domain/episode/remotion_workspace.js";
import { EpisodeSchema } from "../src/domain/episode/schema.js";
import {
	ExperienceRendererMetricsSchema,
	auditExperienceEpisode,
	auditExperienceViewerQuestionTiming,
	buildExperienceBenchmarkSummary,
	buildRendererMetrics,
} from "../src/domain/experience/audit.js";
import { buildExperienceLicenseEvidence } from "../src/domain/experience/license_evidence.js";
import {
	ExperienceContractSchema,
	ExperienceProfileSchema,
} from "../src/domain/experience/schema.js";
import { auditExperienceContract } from "../src/scripts/audit_experience_contract.js";
import { compileEpisode } from "../src/scripts/compile_episode.js";

const root = process.cwd();

const contract = {
	lane: "LIGHT",
	viewer_question: "配当が増えると、何が変わる？",
	visual_metaphor: "コインが配当箱からあふれる",
	hook: {
		setup: "配当が入る",
		surprise: "思ったより大きくあふれる",
		payoff: "利回りで大きさが変わる",
	},
	visible_change: "コインの量が増え、箱から落ちる",
	cute_moment: "主人公がコインを抱きしめる",
	learning_goal: "配当利回りと受取額の関係を理解する",
};

function validEpisode(overrides: Record<string, unknown> = {}) {
	return EpisodeSchema.parse({
		schema_version: 1,
		metadata: { title: "配当", language: "ja" },
		fps: 30,
		sources: [],
		claims: [],
		assets: [],
		visuals: [
			{
				id: "coin-rain",
				type: "title",
				props: { title: "配当" },
				action: "overflow",
				subject: "coins",
				reaction: "happy",
				concept_id: "distribution",
				asset_strategy: "deterministic",
			},
		],
		sections: [
			{
				id: "main",
				title: "配当",
				dialogue: [
					{
						id: "line-1",
						speaker: "Host",
						text: "配当が増えます",
						audio: { path: "audio.wav" },
						visual_ref: "coin-rain",
					},
				],
			},
		],
		thumbnail: { lines: ["配当"] },
		experience: contract,
		...overrides,
	});
}

describe("Experience Contract and OSS benchmark", () => {
	test("keeps experience optional for old episodes and validates the additive contract", () => {
		const legacy = validEpisode();
		const { experience: _experience, ...episodeWithoutExperience } = legacy;
		expect(
			EpisodeSchema.parse(episodeWithoutExperience).experience,
		).toBeUndefined();
		expect(ExperienceContractSchema.safeParse(contract).success).toBe(true);
		expect(
			ExperienceContractSchema.safeParse({ ...contract, viewer_question: " " })
				.success,
		).toBe(false);
	});

	test("measures the complete viewer-question line at the 12-second boundary", () => {
		const episode = validEpisode({
			sections: [
				{
					id: "main",
					title: "Hook",
					dialogue: [
						{
							id: "setup",
							speaker: "Host",
							text: "分配金が多いETFなら有利？",
							audio: { path: "setup.wav" },
						},
						{
							id: "question",
							speaker: "Host",
							text: contract.viewer_question,
							audio: { path: "question.wav" },
						},
					],
				},
			],
		});
		const result = auditExperienceViewerQuestionTiming(episode, [
			{
				sectionId: "main",
				dialogueId: "setup",
				startMs: 0,
				endMs: 4_000,
				startFrame: 0,
				endFrame: 120,
			},
			{
				sectionId: "main",
				dialogueId: "question",
				startMs: 4_000,
				endMs: 12_000,
				startFrame: 120,
				endFrame: 360,
			},
		]);

		expect(result.issues).toEqual([]);
		expect(result.evidence).toEqual({
			viewer_question: contract.viewer_question,
			dialogue_id: "question",
			question_end_ms: 12_000,
			deadline_ms: 12_000,
			measurement_basis: "cumulative_measured_dialogue_audio_duration",
		});
	});

	test("rejects a viewer-question line that ends after 12 seconds", () => {
		const episode = validEpisode({
			sections: [
				{
					id: "main",
					title: "Hook",
					dialogue: [
						{
							id: "question",
							speaker: "Host",
							text: contract.viewer_question,
							audio: { path: "question.wav" },
						},
					],
				},
			],
		});
		const result = auditExperienceViewerQuestionTiming(episode, [
			{
				sectionId: "main",
				dialogueId: "question",
				startMs: 0,
				endMs: 12_001,
				startFrame: 0,
				endFrame: 360,
			},
		]);

		expect(result.evidence).toBeNull();
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"viewer_question_too_late",
		]);
	});

	test("rejects a contract question that is not present in the spoken script", () => {
		const result = auditExperienceViewerQuestionTiming(validEpisode(), [
			{
				sectionId: "main",
				dialogueId: "line-1",
				startMs: 0,
				endMs: 1_000,
				startFrame: 0,
				endFrame: 30,
			},
		]);

		expect(result.evidence).toBeNull();
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"viewer_question_not_in_script",
		]);
	});

	test("compile fails when measured speech places the full question after 12 seconds", async () => {
		const directory = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-question-timing-"),
		);
		try {
			const ffprobe = path.join(directory, "fake-ffprobe");
			await writeFile(
				ffprobe,
				[
					"#!/bin/sh",
					"for last_arg do :; done",
					'case "$last_arg" in',
					"  *setup.wav) printf '3.000\\n' ;;",
					"  *question.wav) printf '9.001\\n' ;;",
					"  *) exit 2 ;;",
					"esac",
				].join("\n"),
				"utf8",
			);
			await chmod(ffprobe, 0o755);
			const episodePath = path.join(directory, "episode.json");
			await writeFile(
				episodePath,
				JSON.stringify(
					validEpisode({
						sections: [
							{
								id: "main",
								title: "Hook",
								dialogue: [
									{
										id: "setup",
										speaker: "Host",
										text: "分配金が多いETFなら有利？",
										audio: { path: "setup.wav" },
									},
									{
										id: "question",
										speaker: "Host",
										text: contract.viewer_question,
										audio: { path: "question.wav" },
									},
								],
							},
						],
					}),
				),
				"utf8",
			);

			await expect(
				compileEpisode({
					episode: episodePath,
					out: path.join(directory, "compiled"),
					ffprobe,
				}),
			).rejects.toThrow(/viewer_question_too_late/);
			const capturedAuditOutput: string[] = [];
			const originalConsoleLog = console.log;
			try {
				console.log = (...values: unknown[]) => {
					capturedAuditOutput.push(values.map(String).join(" "));
				};
				await expect(
					auditExperienceContract(episodePath, root, undefined, ffprobe),
				).resolves.toBe(1);
			} finally {
				console.log = originalConsoleLog;
			}
			expect(capturedAuditOutput.join("\n")).toContain(
				"viewer_question_too_late",
			);
			await writeFile(
				ffprobe,
				[
					"#!/bin/sh",
					"for last_arg do :; done",
					'case "$last_arg" in',
					"  *setup.wav) printf '3.000\\n' ;;",
					"  *question.wav) printf '9.000\\n' ;;",
					"  *) exit 2 ;;",
					"esac",
				].join("\n"),
				"utf8",
			);
			const compiledOutput = path.join(directory, "compiled-at-deadline");
			await compileEpisode({
				episode: episodePath,
				out: compiledOutput,
				ffprobe,
			});
			const manifest = JSON.parse(
				await readFile(
					path.join(compiledOutput, "episode.manifest.json"),
					"utf8",
				),
			);
			expect(manifest.experience_question_timing).toMatchObject({
				dialogue_id: "question",
				question_end_ms: 12_000,
				deadline_ms: 12_000,
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("audits opted-in experience episodes before media processing", async () => {
		const directory = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-compile-"),
		);
		try {
			const episode = validEpisode({
				experience: undefined,
				visuals: [
					{
						id: "coin-rain",
						type: "experience",
						props: {},
						action: "rise",
					},
				],
			});
			const episodePath = path.join(directory, "episode.json");
			await writeFile(episodePath, JSON.stringify(episode), "utf8");

			await expect(
				compileEpisode({
					episode: episodePath,
					out: path.join(directory, "out"),
					ffprobe: "missing-ffprobe",
				}),
			).rejects.toThrow(/experience_missing/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("requires an explicit asset reference when a scene claims asset reuse", () => {
		const profile = ExperienceProfileSchema.parse(
			yaml.load(
				readFileSync(
					path.join(root, "config/channels/byosan/experience.yaml"),
					"utf8",
				),
			),
		);
		const reusedScene = {
			id: "mascot-reaction",
			type: "image",
			props: {},
			action: "exchange",
			asset_strategy: "reuse",
		};
		const withoutReference = validEpisode({ visuals: [reusedScene] });
		const withReference = validEpisode({
			assets: [{ id: "mascot", path: "assets/byosan/character/base.svg" }],
			visuals: [{ ...reusedScene, asset_ref: "mascot" }],
		});
		const withUndeclaredReference = validEpisode({
			visuals: [{ ...reusedScene, asset_ref: "missing-mascot" }],
		});

		expect(
			auditExperienceEpisode(withoutReference, profile).map(
				(issue) => issue.code,
			),
		).toContain("asset_reuse_reference_missing");
		expect(
			auditExperienceEpisode(withUndeclaredReference, profile).map(
				(issue) => issue.code,
			),
		).toContain("asset_reuse_reference_unknown");
		expect(auditExperienceEpisode(withReference, profile)).toEqual([]);
	});

	test("metrics distinguish measured values from unknown GPU and human-review values", () => {
		const metrics = buildRendererMetrics({
			engine: "remotion-existing",
			lane: "EXPLAIN",
			scene_id: "dividend-coin-rain",
			started_at: "2026-09-26T00:00:00.000Z",
			finished_at: "2026-09-26T00:00:02.500Z",
			output_bytes: 4096,
			output_sha256: "a".repeat(64),
		});
		expect(metrics.lane).toBe("EXPLAIN");
		expect(metrics.render_seconds).toBe(2.5);
		expect(metrics.gpu_seconds).toBeNull();
		expect(metrics.manual_fix_count).toBeNull();
		expect(
			ExperienceRendererMetricsSchema.safeParse({
				...metrics,
				lane: "UNSUPPORTED",
			}).success,
		).toBe(false);

		const summary = buildExperienceBenchmarkSummary([
			{
				scene_id: "dividend-coin-rain",
				baseline: metrics,
				motion_canvas: { ...metrics, engine: "motion-canvas" },
			},
		]);
		expect(summary.scenes[0]?.quality_delta.visual_quality_delta).toBeNull();
		expect(summary.scenes[0]?.production_delta.render_seconds).toBe(0);
		expect(summary).not.toHaveProperty("overall_quality_score");
	});

	test("license evidence separates project code, model weights, and unresolved scope", () => {
		const evidence = buildExperienceLicenseEvidence({
			remotionVersion: REMOTION_VERSION,
			motionCanvasVersion: MOTION_CANVAS_VERSION,
		});

		expect(evidence.status).toBe("PARTIALLY_VERIFIED");
		expect(evidence.review_scope).toContain(
			"package.json dependency license declarations are inventoried separately but not independently verified",
		);
		expect(evidence.code_projects).toEqual([
			expect.objectContaining({
				engine: "remotion-existing",
				version: REMOTION_VERSION,
				classification: "SOURCE_AVAILABLE_PROPRIETARY",
				source_license_status: "VERIFIED",
				production_eligibility: "UNVERIFIED",
				source_url: `https://github.com/remotion-dev/remotion/blob/v${REMOTION_VERSION}/LICENSE.md`,
			}),
			expect.objectContaining({
				engine: "motion-canvas",
				package: "@motion-canvas/core",
				version: MOTION_CANVAS_VERSION,
				classification: "OSI_OPEN_SOURCE",
				license: "MIT",
				source_license_status: "VERIFIED",
				production_eligibility: "VERIFIED",
				source_url: `https://raw.githubusercontent.com/motion-canvas/motion-canvas/v${MOTION_CANVAS_VERSION}/LICENSE`,
			}),
		]);
		expect(evidence.model_weights).toMatchObject({
			status: "NOT_USED",
			engines: ["remotion-existing", "motion-canvas"],
		});
		expect(evidence.transitive_dependency_licenses).toBe("UNVERIFIED");
	});

	test("license changes require fresh review when an engine version changes", () => {
		const evidence = buildExperienceLicenseEvidence({
			remotionVersion: "4.0.525",
			motionCanvasVersion: "3.17.3",
		});

		expect(evidence.status).toBe("UNVERIFIED");
		expect(evidence.code_projects[0]).toMatchObject({
			classification: "UNREVIEWED",
			source_license_status: "UNVERIFIED",
			production_eligibility: "UNVERIFIED",
		});
		expect(evidence.code_projects[1]).toMatchObject({
			classification: "UNREVIEWED",
			source_license_status: "UNVERIFIED",
			production_eligibility: "UNVERIFIED",
		});
	});
});
