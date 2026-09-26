import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import ts from "typescript";
import {
	MOTION_CANVAS_VERSION,
	buildMotionCanvasWorkspaceFiles,
} from "../src/domain/episode/motion_canvas_workspace.js";
import {
	buildRemotionInput,
	buildRemotionWorkspaceFiles,
} from "../src/domain/episode/remotion_workspace.js";
import { EpisodeSchema } from "../src/domain/episode/schema.js";
import {
	auditExperienceEpisode,
	buildExperienceBenchmarkSummary,
	buildRendererMetrics,
} from "../src/domain/experience/audit.js";
import {
	ExperienceContractSchema,
	ExperienceProfileSchema,
	ExperienceWorldSchema,
	parseExperienceBenchmark,
} from "../src/domain/experience/schema.js";

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
});
