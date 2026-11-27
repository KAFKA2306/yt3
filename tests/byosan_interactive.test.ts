import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import {
	assertNoSourceNames,
	assertResolvedEnding,
	assertSpeakableLines,
} from "../src/domain/byosan/spoken_humanizer.js";
import {
	buildInteractiveThumbnailFiles,
	buildThumbnailFiles,
} from "../src/domain/byosan/thumbnail.js";

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.remove(dir);
	}
});

describe("spoken_humanizer regression gates", () => {
	test("rejects speaker labels and headline fragments in spoken narration", () => {
		expect(() =>
			assertSpeakableLines([
				{ index: 0, text: "春日部つむぎ：売上が伸びたよ。" },
			]),
		).toThrow("speaker_label_in_spoken_text");
		expect(() =>
			assertSpeakableLines([{ index: 1, text: "ずんだもん: すごいのだ。" }]),
		).toThrow("speaker_label_in_spoken_text");
		expect(() =>
			assertSpeakableLines([
				{ index: 0, text: "売上高、前年同期比で倍になったのだ。" },
			]),
		).toThrow("headline_fragment_in_narration");
		expect(() =>
			assertSpeakableLines([
				{ index: 0, text: "売上高は前年同期比で103%増だったよ。" },
			]),
		).not.toThrow();
	});

	test("rejects authored footnotes and defensive excuses", () => {
		for (const text of [
			"これは予測であり実績ではありません。",
			"12銘柄を持てば安全という保証でもありません。",
			"3年分の上昇が安心を保証しない。",
			"ここから先は断定できません。",
			"記事が示していない因果関係で結ばないこと。",
			"根拠と限界を確認します。",
			"倍率だけでは景気後退の答えになりません。",
			"利益の数字だけではありません。",
			"この比率が1.00を下回ることがあります。",
			"今後2年も利益が伸びると予想されています。",
		]) {
			expect(() => assertSpeakableLines([{ index: 0, text }])).toThrow(
				"BYOSAN_HUMANIZER_FOOTNOTE_OR_EXCUSE",
			);
		}
		expect(() =>
			assertSpeakableLines([
				{ index: 1, text: "景気後退ではなく、株価評価の変化です。" },
			]),
		).not.toThrow();
	});

	test("keeps publishers out of spoken copy", () => {
		expect(() =>
			assertNoSourceNames(
				[{ index: 0, text: "Yardeniは利益予想が強いと分析しています。" }],
				["Yardeni QuickTakes"],
			),
		).toThrow("BYOSAN_HUMANIZER_SOURCE_NAME_IN_PUBLIC_COPY");
		expect(() =>
			assertNoSourceNames(
				[{ index: 0, text: "EPS予想は上向いています。" }],
				["FactSet EPS"],
			),
		).not.toThrow();
	});

	test("rejects unanswered final questions and empty endings", () => {
		expect(() => assertResolvedEnding([{ text: "   " }])).toThrow(
			"BYOSAN_HUMANIZER_EMPTY_ENDING",
		);
		expect(() =>
			assertResolvedEnding([
				{ text: "売上は伸びたよ。" },
				{ text: "なぜ指数は下がったのだろう？" },
			]),
		).toThrow("BYOSAN_HUMANIZER_UNANSWERED_FINAL_QUESTION");
		expect(() =>
			assertResolvedEnding([
				{ text: "売上は伸びたよ。" },
				{ text: "同じ動きじゃないんだね。" },
			]),
		).not.toThrow();
	});
});

describe("interactive vs scheduled thumbnail rendering", () => {
	test("interactive thumbnail outputs textless full-bleed renditions while scheduled keeps overlay", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "byosan-thumb-"));
		tempDirs.push(dir);

		const artPath = path.join(dir, "art.png");
		await sharp({
			create: {
				width: 160,
				height: 90,
				channels: 3,
				background: { r: 123, g: 167, b: 225 },
			},
		})
			.png()
			.toFile(artPath);

		const config = {
			imagegen: { size: "1536x1024", prompt: "{topic}" },
			text: {
				x: 0.05,
				y: 0.1,
				width: 0.5,
				height: 0.7,
				max_font_ratio: 0.1,
				line_height: 1.2,
				max_lines: 3,
				fill: "#FFFFFF",
				stroke: "#000000",
				stroke_ratio: 0.1,
				break_penalty: 10,
			},
			brand: { x: 0.05, y: 0.9, font_ratio: 0.05 },
			scrim: { width: 0.6, opacity: 0.5, color: "#000000" },
			art_scale: 0.8,
			jpeg_quality: 85,
			jpeg_chroma_subsampling: "4:2:0" as const,
		};

		const interactivePng = path.join(dir, "interactive.png");
		const interactiveJpg = path.join(dir, "interactive.jpg");
		const interactiveFull = path.join(dir, "interactive_full.png");
		await buildInteractiveThumbnailFiles({
			topic: "NVIDIA vs NASDAQ",
			artPath,
			refs: [],
			fullPath: interactiveFull,
			pngPath: interactivePng,
			jpgPath: interactiveJpg,
			width: 320,
			height: 180,
			thumbnailWidth: 160,
			thumbnailHeight: 90,
			pngCompression: 6,
			config,
		});

		const interactiveMeta = await sharp(interactivePng).metadata();
		expect(interactiveMeta.width).toBe(160);
		expect(interactiveMeta.height).toBe(90);
		expect(await fs.pathExists(interactiveJpg)).toBe(true);
		const interactiveStats = await sharp(interactiveFull).stats();
		expect(interactiveStats.channels[0]?.stdev ?? 1).toBe(0);

		const scheduledPng = path.join(dir, "scheduled.png");
		const scheduledJpg = path.join(dir, "scheduled.jpg");
		const scheduledFull = path.join(dir, "scheduled_full.png");
		await buildThumbnailFiles({
			text: "テスト見出し",
			artPath,
			refs: [],
			fullPath: scheduledFull,
			pngPath: scheduledPng,
			jpgPath: scheduledJpg,
			brand: "秒算マネー",
			width: 320,
			height: 180,
			thumbnailWidth: 160,
			thumbnailHeight: 90,
			font: "sans-serif",
			fontWeight: 700,
			halfWidthUnits: 0.5,
			pngCompression: 6,
			config,
		});
		const scheduledStats = await sharp(scheduledFull).stats();
		expect(scheduledStats.channels[0]?.stdev ?? 0).toBeGreaterThan(0);
	});
});
