import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
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
