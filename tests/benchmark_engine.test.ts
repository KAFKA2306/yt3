import { afterAll, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	evaluateByosanRun,
	evaluateHumanityRun,
	evaluateYawaCrossRun,
	evaluateYawaRun,
	extractHumanityBaseTitle,
	lexiconMetricsToCheck,
	parseLexiconReport,
	type RunBenchmarkResult,
} from "../src/domain/benchmark/evaluators.js";
import { sha256File } from "../src/domain/publication_state.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-bench-test-"));

afterAll(() => {
	fs.removeSync(tmpRoot);
});

function makeThumb(filePath: string) {
	fs.outputFileSync(filePath, Buffer.alloc(2048, 1));
}

describe("Byosan deterministic benchmark (positive + counterexamples)", () => {
	it("passes a clean verified byosan run", () => {
		const dir = path.join(tmpRoot, "byosan-pass");
		fs.outputJsonSync(path.join(dir, "source", "feature_spec.json"), {
			title: "NVIDIA粗利率75%を支えるCUDA構造",
			segments: [
				{
					text: "一次資料の決算数字から粗利率の構造と競合比較を整理します。",
				},
			],
		});
		fs.outputJsonSync(path.join(dir, "metadata.json"), {
			title: "NVIDIA粗利率75%を支えるCUDA構造",
			description: "一次資料と歴史比較で構造を解説。",
		});
		fs.outputJsonSync(path.join(dir, "audit", "result.json"), {
			production_quality: { status: "PASS" },
			factual_integrity: { status: "PASS" },
			provenance: { status: "PASS" },
		});
		fs.outputJsonSync(path.join(dir, "audit", "authenticity.json"), {
			status: "PASS",
			violations: [],
		});
		fs.outputJsonSync(path.join(dir, "audit", "feature_draft_issues.json"), []);
		fs.outputJsonSync(path.join(dir, "publish", "state.json"), {
			phase: "VERIFIED",
			observed_visibility: "public",
			video_id: "vid_clean_1",
		});
		makeThumb(path.join(dir, "thumbnail_youtube.jpg"));

		const res = evaluateByosanRun(dir);
		expect(res.status).toBe("PASS");
		expect(res.critical_failures).toBe(0);
	});

	it("fails when prohibited investment advice or pipeline failure trace exists", () => {
		const dir = path.join(tmpRoot, "byosan-counterexample");
		fs.outputJsonSync(path.join(dir, "audit", "failure_trace.json"), {
			symptom: "E2BIG: argument list too long",
		});
		fs.outputJsonSync(path.join(dir, "source", "feature_spec.json"), {
			title: "この半導体株は今すぐ買え！暴落確定の理由",
			segments: [{ text: "確実に儲かる銘柄を解説します。" }],
		});
		const res = evaluateByosanRun(dir);
		expect(res.status).toBe("FAIL");
		const ids = res.checks.filter((c) => c.status === "FAIL").map((c) => c.id);
		expect(ids).toContain("pipeline_completed");
		expect(ids).toContain("no_investment_advice");
	});
});

describe("Yawa deterministic benchmark (positive + counterexamples)", () => {
	it("passes a fixed-cast ad-friendly episode with thumbnail and verified publish", () => {
		const dir = path.join(tmpRoot, "yawa-2026-11-20-pass");
		const videoPath = path.join(dir, "video.mp4");
		fs.outputFileSync(videoPath, "fake-mp4-bytes");
		const hash = sha256File(videoPath);
		fs.outputJsonSync(path.join(dir, "script.json"), {
			title: "休日の古本喫茶で雨宿りする午後",
			description: "月島 なお の静かな古本喫茶で淹れたての珈琲を味わう会話劇。",
			tags: ["シチュエーションボイス", "ASMR"],
			segments: [
				{
					text: "いらっしゃい、今日は少し肌寒いね。",
					acting: "穏やかで明瞭な会話声",
				},
			],
		});
		fs.outputJsonSync(path.join(dir, "audit", "result.json"), {
			audio_playable: { status: "PASS" },
			video_playable: { status: "PASS" },
			media_duration: { status: "PASS" },
			metadata_valid: { status: "PASS" },
		});
		fs.outputJsonSync(path.join(dir, "publish", "state.json"), {
			phase: "VERIFIED",
			artifact_sha256: hash,
			video_id: "yawa_vid_1",
		});
		fs.outputJsonSync(path.join(dir, "publish", "receipt.json"), {
			youtube: {
				video_id: "yawa_vid_1",
				channel_title: "夜話アーカイブ ASMR",
				privacy_status: "public",
			},
		});
		makeThumb(path.join(dir, "thumbnail.jpg"));

		const res = evaluateYawaRun(dir);
		expect(res.status).toBe("PASS");
		expect(res.metrics.character_id).toBe("nao");
	});

	it("catches non-cast character, ad-unfriendly terms, breath cues, and missing thumbnail", () => {
		const dir = path.join(tmpRoot, "yawa-2026-11-20-fail");
		fs.outputFileSync(path.join(dir, "video.mp4"), "fake");
		fs.outputJsonSync(path.join(dir, "audit", "result.json"), {
			audio_playable: { status: "PASS" },
		});
		fs.outputJsonSync(path.join(dir, "script.json"), {
			title: "R18 添い寝耳舐めと心理学研究のための記録",
			description: "水野しおりが終電後に寝かしつけ。",
			segments: [
				{
					text: "おやすみ…",
					acting: "耳元で息を吹きかけながら長い吐息",
				},
			],
		});

		const res = evaluateYawaRun(dir);
		expect(res.status).toBe("FAIL");
		const failedIds = res.checks
			.filter((c) => c.status === "FAIL")
			.map((c) => c.id);
		expect(failedIds).toContain("fixed_cast_member");
		expect(failedIds).toContain("ad_friendly_metadata");
		expect(failedIds).toContain("no_prohibited_breath_cues");
		expect(failedIds).toContain("thumbnail_present");
	});

	it("warns on 3-run cast monotony and late-night care convergence", () => {
		const stub = (id: string): RunBenchmarkResult => ({
			product: "yawa",
			run_id: id,
			run_dir: id,
			status: "PASS",
			critical_failures: 0,
			warnings: 0,
			checks: [],
			metrics: { character_id: "shizuku", late_night_care_trope: true },
		});
		const cross = evaluateYawaCrossRun([stub("r1"), stub("r2"), stub("r3")]);
		expect(cross.find((c) => c.id === "cast_rotation")?.status).toBe("WARN");
		expect(
			cross.find((c) => c.id === "no_late_night_care_convergence")?.status,
		).toBe("WARN");
	});
});

describe("Humanity deterministic benchmark (positive + counterexamples)", () => {
	it("passes a short-titled story-world song with jacket and synthetic disclosure", () => {
		const dir = path.join(tmpRoot, "music-2026-11-20-pass");
		makeThumb(path.join(dir, "thumbnail.jpg"));
		fs.outputJsonSync(path.join(dir, "audit", "result.json"), {
			music_integrity: { status: "PASS" },
			music_provenance: { status: "PASS" },
			visual_provenance: { status: "PASS" },
			music_rights: { status: "PASS" },
		});
		fs.outputJsonSync(path.join(dir, "state.json"), {
			contains_synthetic_media: true,
			thumbnail_path: path.join(dir, "thumbnail.jpg"),
			metadata: {
				title: "外れたチェーン | 人類観測所の音楽",
				description:
					"晴れ待ち坂の中腹にある人類観測所で、雨晴はうが見届けた佐伯蓮と日向湊の自転車修理の午後を描いたオリジナル楽曲です。",
			},
		});
		fs.outputJsonSync(path.join(dir, "publish", "state.json"), {
			phase: "VERIFIED",
			observed_visibility: "public",
			video_id: "hum_vid_1",
		});

		expect(extractHumanityBaseTitle("外れたチェーン | 人類観測所の音楽")).toBe(
			"外れたチェーン",
		);
		const res = evaluateHumanityRun(dir);
		expect(res.status).toBe("PASS");
		expect(res.metrics.base_title_chars).toBe(7);
	});

	it("fails long synopsis title, missing disclosure, missing jacket, and audit failure", () => {
		const dir = path.join(tmpRoot, "music-2026-11-20-fail");
		fs.outputJsonSync(path.join(dir, "audit", "result.json"), {
			music_integrity: { status: "FAIL" },
			music_provenance: { status: "PASS" },
			visual_provenance: { status: "PASS" },
			music_rights: { status: "PASS" },
		});
		fs.outputJsonSync(path.join(dir, "state.json"), {
			contains_synthetic_media: false,
			metadata: {
				title:
					"壊れたものは何でも直す人が、唯一直さなかった時計の針を『今』に合わせる朝 | 人類観測所の音楽",
				description: "短い説明",
			},
		});

		const res = evaluateHumanityRun(dir);
		expect(res.status).toBe("FAIL");
		const failedIds = res.checks
			.filter((c) => c.status === "FAIL")
			.map((c) => c.id);
		expect(failedIds).toContain("music_audits_pass");
		expect(failedIds).toContain("synthetic_media_disclosed");
		expect(failedIds).toContain("short_memorable_title");
		expect(failedIds).toContain("jacket_thumbnail_present");
	});
});

describe("Lexicon diversity parser", () => {
	it("flags excessive pairwise Jaccard similarity", () => {
		const parsed = parseLexiconReport(
			[
				"humanity: documents=10 content_words=900",
				"MATTR(window=50) mean=0.712 documents=10",
				"pairwise Jaccard mean=0.220 max=0.610",
			].join("\n"),
		);
		const check = lexiconMetricsToCheck(parsed);
		expect(check.status).toBe("WARN");
		expect(parsed.mattr_mean).toBe(0.712);
	});
});
