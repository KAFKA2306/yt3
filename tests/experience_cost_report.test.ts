import { describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRendererMetrics } from "../src/domain/experience/audit.js";
import { generateExperienceCostReport } from "../src/scripts/report_experience_cost.js";

function metrics(lane: "LIGHT" | "EXPLAIN" | "DEEP" | undefined) {
	return buildRendererMetrics({
		engine: "remotion-existing",
		...(lane ? { lane } : {}),
		scene_id: lane ?? "unassigned",
		started_at: "2026-09-26T00:00:00.000Z",
		finished_at: "2026-09-26T00:00:05.000Z",
		render_seconds: 3,
		output_bytes: 4096,
		output_sha256: "a".repeat(64),
		new_asset_count: 1,
		reused_asset_count: 2,
	});
}

function ttsManifest(
	lane: "LIGHT" | "EXPLAIN" | "DEEP" | undefined,
	seconds: number[],
) {
	return {
		language: "ja",
		...(lane ? { lane } : {}),
		generation_duration_basis: "tts_synthesize_call_wall_clock_seconds",
		records: seconds.map((generation_seconds) => ({ generation_seconds })),
	};
}

describe("experience lane cost report", () => {
	test("summarizes validated metrics with lane and source-hash provenance", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "yt3-experience-cost-"));
		try {
			const baseline = path.join(root, "run-a", "baseline");
			const tts = path.join(root, "run-a", "episode");
			const unassigned = path.join(root, "run-a", "scenes", "scene-1");
			const unassignedTts = path.join(root, "run-b", "episode");
			await Promise.all([
				mkdir(baseline, { recursive: true }),
				mkdir(tts, { recursive: true }),
				mkdir(unassigned, { recursive: true }),
				mkdir(unassignedTts, { recursive: true }),
			]);
			await Promise.all([
				writeFile(
					path.join(baseline, "metrics.json"),
					`${JSON.stringify(metrics("EXPLAIN"))}\n`,
				),
				writeFile(
					path.join(unassigned, "metrics.json"),
					`${JSON.stringify(metrics(undefined))}\n`,
				),
				writeFile(
					path.join(tts, "tts-manifest-ja.json"),
					`${JSON.stringify(ttsManifest("LIGHT", [1.25, 0.75]))}\n`,
				),
				writeFile(
					path.join(unassignedTts, "tts-manifest-ja.json"),
					`${JSON.stringify(ttsManifest(undefined, [2.5]))}\n`,
				),
			]);
			const output = path.join(root, "cost-report.json");

			const report = await generateExperienceCostReport(root, output);

			expect(report.by_lane.EXPLAIN.metric_count).toBe(1);
			expect(report.by_lane.LIGHT.generation_seconds).toEqual({
				total: 2,
				mean: 1,
				measured_attempts: 2,
				manifest_count: 1,
			});
			expect(report.metrics_without_lane).toBe(1);
			expect(report.generation_manifests_without_lane).toBe(1);
			expect(report.generation_attempts_without_lane).toBe(1);
			expect(report.measurement_scope.generation_wall_seconds_measured).toBe(
				true,
			);
			expect(report.inputs).toHaveLength(4);
			expect(report.inputs.map((source) => source.path)).toEqual([
				"run-a/baseline/metrics.json",
				"run-a/episode/tts-manifest-ja.json",
				"run-a/scenes/scene-1/metrics.json",
				"run-b/episode/tts-manifest-ja.json",
			]);
			expect(report.inputs[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(JSON.parse(await readFile(output, "utf8"))).toEqual(report);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects malformed metric evidence instead of silently omitting it", async () => {
		const root = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-cost-invalid-"),
		);
		try {
			const invalid = path.join(root, "bad", "metrics.json");
			await mkdir(path.dirname(invalid), { recursive: true });
			await writeFile(invalid, "not json\n");
			const output = path.join(root, "report.json");

			await expect(generateExperienceCostReport(root, output)).rejects.toThrow(
				"invalid JSON in Experience cost input",
			);
			await writeFile(invalid, "{}\n");
			await expect(generateExperienceCostReport(root, output)).rejects.toThrow(
				"invalid Experience renderer metrics",
			);
			expect(await stat(output).catch(() => null)).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects malformed TTS timing evidence instead of omitting it", async () => {
		const root = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-cost-invalid-tts-"),
		);
		try {
			const manifest = path.join(root, "run", "tts-manifest-ja.json");
			await mkdir(path.dirname(manifest), { recursive: true });
			await writeFile(
				manifest,
				`${JSON.stringify(ttsManifest("LIGHT", [1, Number.NaN]))}\n`,
			);
			const output = path.join(root, "report.json");
			await expect(generateExperienceCostReport(root, output)).rejects.toThrow(
				"invalid TTS generation manifest",
			);
			expect(await stat(output).catch(() => null)).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects empty roots and symlinked metric paths instead of reporting partial data", async () => {
		const root = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-cost-boundary-"),
		);
		try {
			const output = path.join(root, "report.json");
			await expect(generateExperienceCostReport(root, output)).rejects.toThrow(
				"no metrics.json or TTS generation manifests found",
			);

			const outside = path.join(root, "outside-metrics.json");
			const nested = path.join(root, "benchmarks");
			await mkdir(nested);
			await writeFile(outside, `${JSON.stringify(metrics("LIGHT"))}\n`);
			await symlink(outside, path.join(nested, "metrics.json"));
			await expect(generateExperienceCostReport(root, output)).rejects.toThrow(
				"symlinked benchmark path is not allowed",
			);
			expect(await stat(output).catch(() => null)).toBeNull();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
