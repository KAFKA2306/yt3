import { describe, expect, test } from "bun:test";
import {
	buildMetadata,
	draftSegments,
	loadYawaConfig,
	readYawaMetadata,
	ScriptDraftSchema,
} from "../src/domain/yawa_daily.js";

const episode = {
	title: "閉館前の投函口",
	adult_characters_confirmed: true,
	rights_confirmed: true,
	voices: { keeper: { caption: "輪郭のはっきりした中音" } },
	image: "切り絵で古い郵便受けを描く",
} as const;

describe("Yawa production contract", () => {
	test("accepts an unchaptered voice with no reference and no metadata template", () => {
		loadYawaConfig(process.cwd());
		const draft = ScriptDraftSchema.parse({
			...episode,
			segments: [{ text: "まだ窓は開いているよ。", direction: "遠くから" }],
		});
		expect(draftSegments(draft)).toEqual([
			{ text: "まだ窓は開いているよ。", direction: "遠くから" },
		]);
		expect(buildMetadata(draft)).toMatchObject({
			title: episode.title,
			tags: [],
		});
	});

	test("keeps chapter order and each voice's reference and performance controls", () => {
		const chaptered = {
			...episode,
			voices: {
				...episode.voices,
				visitor: { caption: "高めの早口", reference: { text: "間に合った。" } },
			},
			chapters: [
				{ segments: [{ text: "見て。", voice: "visitor", seconds: 2 }] },
				{
					name: "投函",
					segments: [{ text: "どうぞ。", voice: "keeper", pause: 0.8 }],
				},
			],
			first: "image",
		} as const;
		const draft = ScriptDraftSchema.parse(chaptered);
		expect(draft.voices.visitor?.reference).toEqual({ text: "間に合った。" });
		expect(draftSegments(draft)).toEqual([
			...chaptered.chapters[0].segments,
			...chaptered.chapters[1].segments,
		]);
		expect(
			ScriptDraftSchema.safeParse({
				...chaptered,
				segments: chaptered.chapters[0]?.segments,
			}).success,
		).toBe(false);
		expect(
			ScriptDraftSchema.safeParse({
				...chaptered,
				chapters: [{ segments: [{ text: "どうぞ。" }] }],
			}).success,
		).toBe(false);
	});

	test("uses YouTube limits without truncating legacy or generated metadata", () => {
		expect(
			readYawaMetadata({
				title: "既存作",
				description: "保存済み",
				tags: ["記録"],
			}),
		).toEqual({ title: "既存作", description: "保存済み", tags: ["記録"] });
		expect(() => buildMetadata({ title: "a".repeat(101) })).toThrow();
		expect(() =>
			buildMetadata({ title: "題", description: "夜".repeat(1667) }),
		).toThrow();
		expect(() =>
			buildMetadata({ title: "題", tags: [`${"a".repeat(499)} b`] }),
		).toThrow();
	});
});
