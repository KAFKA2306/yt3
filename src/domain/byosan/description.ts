import { z } from "zod";
import type { ByosanFeatureSource, ByosanFeatureSpec } from "./feature_spec.js";

const nonEmptyString = z.string().min(1);
const positiveInteger = z.number().int().positive();

export const ByosanChaptersConfigSchema = z.object({
	max_title_chars: positiveInteger,
	min_chapter_seconds: z.number().positive(),
	min_chapters: positiveInteger,
	max_chapters: positiveInteger,
	headings: z.object({
		key_points: nonEmptyString,
		chapters: nonEmptyString,
		primary_sources: nonEmptyString,
		reference_sources: nonEmptyString,
	}),
});

export type ByosanChaptersConfig = z.infer<typeof ByosanChaptersConfigSchema>;

export type ChapterSpan = { headline: string; duration: number };

export type Chapter = { start: number; title: string };

export type ByosanDescriptionInput = Pick<
	ByosanFeatureSpec,
	"descriptionLead" | "descriptionBullets" | "disclaimer" | "sources" | "claims"
>;

type ChapterDraft = { start: number; duration: number; title: string };

export function formatChapterTimestamp(seconds: number): string {
	const rounded = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(rounded / 3600);
	const minutes = Math.floor((rounded % 3600) / 60);
	const secs = rounded % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
		: `${minutes}:${String(secs).padStart(2, "0")}`;
}

function groupByHeadline(timeline: readonly ChapterSpan[]): ChapterDraft[] {
	const chapters: ChapterDraft[] = [];
	let cursor = 0;
	for (const span of timeline) {
		const last = chapters.at(-1);
		if (last && last.title === span.headline) {
			last.duration += span.duration;
		} else {
			chapters.push({
				start: cursor,
				duration: span.duration,
				title: span.headline,
			});
		}
		cursor += span.duration;
	}
	return chapters;
}

function mergeAt(chapters: ChapterDraft[], index: number): ChapterDraft[] {
	const [left, right] = chapters.slice(index, index + 2);
	if (!left || !right) {
		throw new Error(`BYOSAN_CHAPTER_MERGE_OUT_OF_RANGE: ${index}`);
	}
	return [
		...chapters.slice(0, index),
		{
			start: left.start,
			duration: left.duration + right.duration,
			title: left.title,
		},
		...chapters.slice(index + 2),
	];
}

function mergeShortChapters(
	chapters: ChapterDraft[],
	minSeconds: number,
): ChapterDraft[] {
	const index = chapters.findIndex((chapter) => chapter.duration < minSeconds);
	if (index < 0 || chapters.length < 2) return chapters;
	return mergeShortChapters(
		mergeAt(chapters, index > 0 ? index - 1 : index),
		minSeconds,
	);
}

function narrowestPairIndex(chapters: ChapterDraft[]): number {
	const pairs = chapters.slice(0, -1).map((left, index) => ({
		index,
		seconds:
			left.duration +
			chapters
				.slice(index + 1, index + 2)
				.reduce((sum, next) => sum + next.duration, 0),
	}));
	return pairs.reduce((best, pair) =>
		pair.seconds < best.seconds ? pair : best,
	).index;
}

function mergeToMaxChapters(
	chapters: ChapterDraft[],
	maxChapters: number,
): ChapterDraft[] {
	if (chapters.length <= maxChapters) return chapters;
	return mergeToMaxChapters(
		mergeAt(chapters, narrowestPairIndex(chapters)),
		maxChapters,
	);
}

export function planByosanChapters(
	timeline: readonly ChapterSpan[],
	config: ByosanChaptersConfig,
): Chapter[] {
	const chapters = mergeToMaxChapters(
		mergeShortChapters(groupByHeadline(timeline), config.min_chapter_seconds),
		config.max_chapters,
	);
	if (chapters.length < config.min_chapters) {
		throw new Error(
			`BYOSAN_CHAPTERS_TOO_FEW: ${chapters.length} < ${config.min_chapters}`,
		);
	}
	return chapters.map(({ start, title }) => {
		if ([...title].length > config.max_title_chars) {
			throw new Error(
				`BYOSAN_CHAPTER_TITLE_TOO_LONG: ${title} (max ${config.max_title_chars})`,
			);
		}
		return { start, title };
	});
}

export function classifyByosanSources(
	sources: readonly ByosanFeatureSource[],
	claims: ByosanDescriptionInput["claims"],
): { primary: ByosanFeatureSource[]; reference: ByosanFeatureSource[] } {
	const cited = new Set(claims.flatMap((claim) => claim.sourceIds));
	return {
		primary: sources.filter((source) => cited.has(source.id)),
		reference: sources.filter((source) => !cited.has(source.id)),
	};
}

export function buildByosanDescription(
	spec: ByosanDescriptionInput,
	timeline: readonly ChapterSpan[],
	config: ByosanChaptersConfig,
): string {
	const chapters = planByosanChapters(timeline, config)
		.map(
			(chapter) => `${formatChapterTimestamp(chapter.start)} ${chapter.title}`,
		)
		.join("\n");
	const { primary, reference } = classifyByosanSources(
		spec.sources,
		spec.claims,
	);
	const sourceBlock = (sources: readonly ByosanFeatureSource[]): string =>
		sources.map((source) => `${source.name}\n${source.url}`).join("\n\n");
	const bullets = spec.descriptionBullets
		.map((bullet) => `・${bullet}`)
		.join("\n");
	return [
		spec.descriptionLead,
		`${config.headings.key_points}\n${bullets}`,
		`${config.headings.chapters}\n${chapters}`,
		...(primary.length > 0
			? [`${config.headings.primary_sources}\n${sourceBlock(primary)}`]
			: []),
		...(reference.length > 0
			? [`${config.headings.reference_sources}\n${sourceBlock(reference)}`]
			: []),
		`※${spec.disclaimer}`,
	].join("\n\n");
}
