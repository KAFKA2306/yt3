import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import ts from "typescript";
import {
	MOTION_CANVAS_VERSION,
	buildMotionCanvasWorkspaceFiles,
} from "../src/domain/episode/motion_canvas_workspace.js";
import {
	REMOTION_VERSION,
	buildRemotionInput,
	buildRemotionWorkspaceFiles,
} from "../src/domain/episode/remotion_workspace.js";
import { EpisodeSchema } from "../src/domain/episode/schema.js";
import {
	auditExperienceEpisode,
	buildExperienceBenchmarkSummary,
	buildRendererMetrics,
} from "../src/domain/experience/audit.js";
import { buildExperienceLicenseEvidence } from "../src/domain/experience/license_evidence.js";
import {
	ExperienceContractSchema,
	ExperienceProfileSchema,
	ExperienceWorldSchema,
	parseExperienceBenchmark,
} from "../src/domain/experience/schema.js";
import { compileEpisode } from "../src/scripts/compile_episode.js";
import { installBunWorkspace } from "../src/scripts/experience_workspace.js";

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

	test("installs isolated benchmark workspaces with a persistent lockfile", async () => {
		const workspace = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-workspace-"),
		);
		try {
			const localPackage = path.join(workspace, "local-package");
			await mkdir(localPackage);
			await writeFile(
				path.join(localPackage, "package.json"),
				JSON.stringify({ name: "yt3-lockfile-fixture", version: "1.0.0" }),
				"utf8",
			);
			await writeFile(
				path.join(workspace, "package.json"),
				JSON.stringify({
					name: "yt3-experience-workspace-test",
					version: "1.0.0",
					dependencies: { "yt3-lockfile-fixture": "file:./local-package" },
				}),
				"utf8",
			);
			await installBunWorkspace(workspace);

			expect(
				readFileSync(path.join(workspace, "bun.lock"), "utf8").length,
			).toBeGreaterThan(0);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("audits the byosan LIGHT lane and rejects explain-only scenes", () => {
		const profile = yaml.load(
			readFileSync(
				path.join(root, "config/channels/byosan/experience.yaml"),
				"utf8",
			),
		);
		const parsedProfile = ExperienceProfileSchema.parse(profile);
		expect(auditExperienceEpisode(validEpisode(), parsedProfile)).toEqual([]);
		expect(
			auditExperienceEpisode(
				validEpisode({ experience: undefined }),
				parsedProfile,
			).map((issue) => issue.code),
		).toContain("experience_missing");

		const invalid = validEpisode({
			visuals: [
				{
					id: "scene-1",
					type: "title",
					props: {},
					action: "explain",
					concept_id: "one",
				},
				{
					id: "scene-2",
					type: "title",
					props: {},
					action: "show",
					concept_id: "two",
					asset_strategy: "generated",
				},
				{
					id: "scene-3",
					type: "title",
					props: {},
					concept_id: "three",
					asset_strategy: "generated",
				},
			],
		});
		const issues = auditExperienceEpisode(invalid, parsedProfile);
		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"light_concept_limit",
				"scene_action_missing",
				"action_forbidden",
			]),
		);
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

	test("validates both byosan config files and the fixed five-scene fixture", () => {
		const profile = ExperienceProfileSchema.parse(
			yaml.load(
				readFileSync(
					path.join(root, "config/channels/byosan/experience.yaml"),
					"utf8",
				),
			),
		);
		const world = ExperienceWorldSchema.parse(
			yaml.load(
				readFileSync(
					path.join(root, "config/channels/byosan/world.yaml"),
					"utf8",
				),
			),
		);
		const benchmark = parseExperienceBenchmark(
			readFileSync(
				path.join(root, "config/channels/byosan/benchmark-scenes.json"),
				"utf8",
			),
		);

		expect(profile.channel).toBe("byosan_money");
		expect(world.visual_vocabulary.length).toBeGreaterThanOrEqual(10);
		expect(benchmark.items.map((scene) => scene.id)).toEqual([
			"dividend-coin-rain",
			"per-balloon",
			"covered-call-tether",
			"drawdown-floor",
			"capex-capacity",
		]);
		expect(
			benchmark.items.every((scene) => scene.visual.action?.length),
		).toBeTruthy();
	});

	test("Motion Canvas workspace is isolated, pinned, and built from the canonical input", () => {
		const benchmark = parseExperienceBenchmark(
			readFileSync(
				path.join(root, "config/channels/byosan/benchmark-scenes.json"),
				"utf8",
			),
		);
		const world = ExperienceWorldSchema.parse(
			yaml.load(
				readFileSync(
					path.join(root, "config/channels/byosan/world.yaml"),
					"utf8",
				),
			),
		);
		const files = buildMotionCanvasWorkspaceFiles(benchmark, world);
		const packageJson = JSON.parse(files["package.json"] ?? "{}");

		expect(MOTION_CANVAS_VERSION).toBe("3.17.2");
		expect(packageJson.dependencies["@motion-canvas/core"]).toBe("3.17.2");
		expect(files["src/project.ts"]).toContain("?scene");
		for (const scene of benchmark.items) {
			expect(files[`src/scenes/${scene.id}.tsx`]).toContain(
				scene.visual.action,
			);
		}
	});

	test("passes experience fields and the configured world into the Remotion baseline", () => {
		const episode = validEpisode();
		const input = buildRemotionInput(episode, [
			{
				sectionId: "main",
				dialogueId: "line-1",
				startMs: 0,
				endMs: 1_000,
				startFrame: 0,
				endFrame: 30,
			},
		]);
		const world = ExperienceWorldSchema.parse(
			yaml.load(
				readFileSync(
					path.join(root, "config/channels/byosan/world.yaml"),
					"utf8",
				),
			),
		);
		const remotionFiles = buildRemotionWorkspaceFiles(world);

		expect(input.items[0]?.visual).toMatchObject({
			type: "title",
			action: "overflow",
			subject: "coins",
			reaction: "happy",
			concept_id: "distribution",
			asset_strategy: "deterministic",
		});
		expect(remotionFiles["entry.tsx"]).toContain('"coin":"#F6C453"');
		expect(remotionFiles["entry.tsx"]).toContain('case "coin_rain"');
		const emitted = ts.transpileModule(remotionFiles["entry.tsx"] ?? "", {
			compilerOptions: {
				jsx: ts.JsxEmit.ReactJSX,
				module: ts.ModuleKind.ESNext,
				target: ts.ScriptTarget.ES2022,
			},
			reportDiagnostics: true,
		});
		expect(emitted.diagnostics).toEqual([]);
	});

	test("metrics distinguish measured values from unknown GPU and human-review values", () => {
		const metrics = buildRendererMetrics({
			engine: "remotion-existing",
			scene_id: "dividend-coin-rain",
			started_at: "2026-09-26T00:00:00.000Z",
			finished_at: "2026-09-26T00:00:02.500Z",
			output_bytes: 4096,
			output_sha256: "a".repeat(64),
		});
		expect(metrics.render_seconds).toBe(2.5);
		expect(metrics.gpu_seconds).toBeNull();
		expect(metrics.manual_fix_count).toBeNull();

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
