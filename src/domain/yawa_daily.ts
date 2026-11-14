import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import * as yaml from "js-yaml";
import { z } from "zod";

export const YAWA_BUCKET = "yawa_archive";
export const YAWA_RUN_NAME = /^yawa-\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/;

const text = z.string().trim().min(1);
const filename = text.regex(/^[\w.-]+\.wav$/i);
const creativeSchema = z.strictObject({
	purpose: text,
	direction: text,
	voice_preference: text,
	creative_control: text,
	runtime: text.regex(/^[a-zA-Z0-9_.-]+\.ya?ml$/),
});
const runtimeSchema = z.strictObject({
	script: z.strictObject({ model: text }),
	tts: z.strictObject({
		directory: text,
		checkpoint: text,
		cache: text,
		device: z.enum(["cuda", "cpu", "mps"]),
		precision: z.enum(["bf16", "fp32"]),
	}),
	cover: z.strictObject({ tool: z.literal("codex-imagegen"), size: text }),
});

export function loadYawaConfig(root: string) {
	const dir = path.join(root, "config", "yawa");
	const read = (name: string) =>
		yaml.load(fs.readFileSync(path.join(dir, name), "utf8"));
	const { runtime, ...creative } = creativeSchema.parse(read("daily.yaml"));
	return { creative, ...runtimeSchema.parse(read(runtime)) };
}

export function runtimePath(root: string, value: string): string {
	return value.startsWith("~/")
		? path.join(os.homedir(), value.slice(2))
		: path.resolve(root, value);
}

const segment = z.strictObject({
	text,
	voice: text.optional(),
	direction: text.optional(),
	seconds: z.number().positive().optional(),
	pause: z.number().nonnegative().optional(),
	gain_db: z.number().optional(),
});
const voice = z.strictObject({
	caption: text.optional(),
	reference: z
		.union([z.strictObject({ text }), z.strictObject({ file: filename })])
		.optional(),
});
const metadataSchema = z.object({
	title: text,
	description: z.string().trim().optional(),
	tags: z.array(text).optional(),
});

export const ScriptDraftSchema = metadataSchema
	.extend({
		adult_characters_confirmed: z.literal(true),
		rights_confirmed: z.literal(true),
		voices: z.record(text, voice),
		segments: z.array(segment).min(1).optional(),
		chapters: z
			.array(
				z.strictObject({
					name: text.optional(),
					segments: z.array(segment).min(1),
				}),
			)
			.min(1)
			.optional(),
		image: text,
		first: z.enum(["audio", "image"]).optional(),
		zoom: z
			.tuple([z.number().min(1).max(10), z.number().min(1).max(10)])
			.optional(),
	})
	.strict()
	.superRefine((draft, context) => {
		if (Boolean(draft.segments) === Boolean(draft.chapters))
			context.addIssue({
				code: "custom",
				message: "Supply segments or chapters",
			});
		const names = Object.keys(draft.voices);
		if (names.length === 0)
			context.addIssue({
				code: "custom",
				message: "Supply at least one voice",
			});
		for (const [index, item] of draftSegments(draft).entries()) {
			if (
				item.voice === undefined
					? names.length !== 1
					: !Object.hasOwn(draft.voices, item.voice)
			)
				context.addIssue({
					code: "custom",
					message: `Unknown or ambiguous voice in segment ${index + 1}`,
				});
		}
	});

export type ScriptDraft = z.infer<typeof ScriptDraftSchema>;

export function draftSegments(draft: ScriptDraft) {
	return (
		draft.segments ??
		draft.chapters?.flatMap((chapter) => chapter.segments) ??
		[]
	);
}

export function buildMetadata(
	input: Pick<ScriptDraft, "title" | "description" | "tags">,
) {
	return readYawaMetadata({
		title: input.title,
		description: [
			input.description,
			"台本・音声・画像はAIを使用して制作しました。",
		]
			.filter(Boolean)
			.join("\n\n"),
		tags: input.tags,
	});
}

export function readYawaMetadata(value: unknown) {
	const { title, description = "", tags = [] } = metadataSchema.parse(value);
	const tagLength = tags
		.map((tag) => (tag.includes(" ") ? `"${tag}"` : tag))
		.join(",");
	if (
		/[<>]/.test(title + description) ||
		title.length > 100 ||
		Buffer.byteLength(description) > 5000 ||
		[...tagLength].length > 500
	)
		throw new Error("Yawa metadata exceeds the YouTube snippet contract");
	return { title, description, tags };
}

export function parseYawaJson(text: string): unknown {
	return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ""));
}
