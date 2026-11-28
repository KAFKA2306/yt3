import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import { getByosanProductionConfig } from "../src/domain/byosan/production_config.js";
import {
	assertNoSourceNames,
	assertResolvedEnding,
	assertSpeakableLines,
} from "../src/domain/byosan/spoken_humanizer.js";
import {
	buildByosanThumbnailFiles,
	buildByosanThumbnailPrompt,
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
				{ index: 0, text: "青山龍星：値動きを予想せず、決めた日に買う。" },
			]),
		).toThrow("speaker_label_in_spoken_text");
		expect(() =>
			assertSpeakableLines([
				{ index: 1, text: "秒算マネー: 決めた日に買う。" },
			]),
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

describe("canonical Byosan thumbnail", () => {
	test("representative economic paradoxes produce specific, feed-readable image prompts", () => {
		const template =
			getByosanProductionConfig().feature_production.thumbnail.imagegen.prompt;
		const topics = [
			"半導体設備投資が膨らむ一方、投資家は回収時期を問う",
			"24KBのLLMがOSコストを崩す仕組み",
			"金利ショックで債券価格が急落し、住宅ローンへ波及する",
		];
		for (const topic of topics) {
			const prompt = buildByosanThumbnailPrompt(template, topic);
			expect(prompt).toContain(topic);
			expect(prompt).toContain("one decisive action");
			expect(prompt).toContain("strong light-dark and color contrast");
			expect(prompt).toContain("reads at phone size in one second");
			expect(prompt).toContain("no reserved title space");
			expect(prompt).toContain(
				"Avoid stock finance imagery and generic AI wallpaper",
			);
			for (const visualBanality of [
				"floating coins",
				"glowing brains",
				"anonymous circuit boards",
				"default candlestick charts",
			]) {
				expect(prompt).toContain(visualBanality);
			}
			expect(prompt).toContain("Image only: no text, letters, numerals");
			for (const legacy of [
				"left for the existing title overlay",
				"light watercolor",
				"impressionist",
				"calloutTop",
				"予測値",
				"実績と別",
				"限界",
				"※注釈",
			]) {
				expect(prompt).not.toContain(legacy);
			}
		}
		expect(() =>
			buildByosanThumbnailPrompt("missing placeholder", "story"),
		).toThrow("BYOSAN_THUMBNAIL_PROMPT_MISSING_TOPIC");
	});

	test("the single renderer produces image-only full-bleed renditions", async () => {
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
			jpeg_quality: 85,
			jpeg_chroma_subsampling: "4:2:0" as const,
		};

		const pngPath = path.join(dir, "thumbnail.png");
		const jpgPath = path.join(dir, "thumbnail.jpg");
		const fullPath = path.join(dir, "thumbnail_full.png");
		await buildByosanThumbnailFiles({
			topic: "NVIDIA vs NASDAQ",
			artPath,
			refs: [],
			fullPath,
			pngPath,
			jpgPath,
			width: 320,
			height: 180,
			thumbnailWidth: 160,
			thumbnailHeight: 90,
			pngCompression: 6,
			config,
		});

		const metadata = await sharp(pngPath).metadata();
		expect(metadata.width).toBe(160);
		expect(metadata.height).toBe(90);
		expect(await fs.pathExists(jpgPath)).toBe(true);
		const stats = await sharp(fullPath).stats();
		expect(stats.channels[0]?.stdev ?? 1).toBe(0);
	});
});
