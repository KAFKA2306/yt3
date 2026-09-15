import { z } from "zod";

export const EpisodeTemplateSchema = z.enum([
	"title",
	"two-column",
	"comparison",
	"timeline",
	"number-highlight",
	"quote",
	"source-card",
	"image",
	"terminal",
	"github",
]);

const IdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const EpisodeAssetSchema = z.object({
	id: IdSchema,
	path: z.string().min(1),
});

export const EpisodeSourceSchema = z.object({
	id: IdSchema,
	url: z.string().url(),
	title: z.string().min(1).optional(),
});

export const EpisodeClaimSchema = z.object({
	id: IdSchema,
	text: z.string().min(1),
	source_ids: z.array(IdSchema).min(1),
});

export const EpisodeVisualElementSchema = z.object({
	id: IdSchema,
	text: z.string().optional(),
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
	width: z.number().positive().max(1),
	height: z.number().positive().max(1),
});

export const EpisodeVisualSchema = z.object({
	id: IdSchema,
	type: EpisodeTemplateSchema,
	props: z.record(z.string(), z.unknown()).default({}),
	elements: z.array(EpisodeVisualElementSchema).default([]),
	asset_ref: IdSchema.optional(),
	source_ref: IdSchema.optional(),
});

export const EpisodeDialogueSchema = z.object({
	id: IdSchema,
	speaker: z.string().min(1),
	text: z.string().min(1),
	subtitle: z.string().min(1).optional(),
	emotion: z.string().min(1).optional(),
	visual_ref: IdSchema.optional(),
	audio: z.object({
		path: z.string().min(1),
	}),
});

export const EpisodeSectionSchema = z.object({
	id: IdSchema,
	title: z.string().min(1),
	dialogue: z.array(EpisodeDialogueSchema).min(1),
});

export const EpisodeSchema = z.object({
	schema_version: z.literal(1),
	metadata: z.object({
		title: z.string().min(1),
		description: z.string().default(""),
		tags: z.array(z.string().min(1)).default([]),
		language: z.string().min(2),
	}),
	fps: z.number().int().min(1).max(120).default(30),
	sources: z.array(EpisodeSourceSchema).default([]),
	claims: z.array(EpisodeClaimSchema).default([]),
	assets: z.array(EpisodeAssetSchema).default([]),
	visuals: z.array(EpisodeVisualSchema).default([]),
	sections: z.array(EpisodeSectionSchema).min(1),
	thumbnail: z.object({
		lines: z.array(z.string().min(1)).min(1).max(2),
		background_asset_ref: IdSchema.optional(),
		layout: z.record(z.string(), z.unknown()).default({}),
	}),
	shorts: z
		.object({
			enabled: z.boolean().default(true),
			max_seconds: z.number().positive().max(180).default(60),
		})
		.default({ enabled: true, max_seconds: 60 }),
	locales: z.array(z.string().min(2)).default([]),
});

export const LocalePatchSchema = z.object({
	locale: z.string().min(2),
	strings: z.record(z.string(), z.string()),
});

export type Episode = z.infer<typeof EpisodeSchema>;
export type EpisodeVisual = z.infer<typeof EpisodeVisualSchema>;
export type EpisodeTemplate = z.infer<typeof EpisodeTemplateSchema>;
export type LocalePatch = z.infer<typeof LocalePatchSchema>;

export function parseEpisode(text: string): Episode {
	return EpisodeSchema.parse(JSON.parse(text));
}

export function parseLocalePatch(text: string): LocalePatch {
	return LocalePatchSchema.parse(JSON.parse(text));
}
