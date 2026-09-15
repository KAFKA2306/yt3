import { createHash } from "node:crypto";
import type { Episode, LocalePatch } from "./schema.js";

export interface EpisodeTimelineItem {
	sectionId: string;
	dialogueId: string;
	startMs: number;
	endMs: number;
	startFrame: number;
	endFrame: number;
}

export interface EpisodeAuditIssue {
	code: string;
	path: string;
	message: string;
}

export interface EpisodeShortPlan {
	aspect_ratio: "9:16";
	dialogue_ids: string[];
	section_ids: string[];
	hook_dialogue_id: string;
	highlight_dialogue_ids: string[];
	cta: string;
	duration_ms: number;
}

function allDialogues(episode: Episode) {
	return episode.sections.flatMap((section) =>
		section.dialogue.map((dialogue) => ({ section, dialogue })),
	);
}

function duplicateIssues(values: string[], path: string): EpisodeAuditIssue[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) duplicates.add(value);
		seen.add(value);
	}
	return [...duplicates].map((value) => ({
		code: "duplicate_id",
		path,
		message: `duplicate id: ${value}`,
	}));
}

function boxesOverlap(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number },
): boolean {
	return !(
		a.x + a.width <= b.x ||
		b.x + b.width <= a.x ||
		a.y + a.height <= b.y ||
		b.y + b.height <= a.y
	);
}

export function auditEpisode(episode: Episode): EpisodeAuditIssue[] {
	const issues: EpisodeAuditIssue[] = [];
	const sourceIds = new Set(episode.sources.map((source) => source.id));
	const assetIds = new Set(episode.assets.map((asset) => asset.id));
	const visualIds = new Set(episode.visuals.map((visual) => visual.id));
	const dialogues = allDialogues(episode);

	issues.push(
		...duplicateIssues(episode.sources.map((item) => item.id), "sources"),
		...duplicateIssues(episode.claims.map((item) => item.id), "claims"),
		...duplicateIssues(episode.assets.map((item) => item.id), "assets"),
		...duplicateIssues(episode.visuals.map((item) => item.id), "visuals"),
		...duplicateIssues(episode.sections.map((item) => item.id), "sections"),
		...duplicateIssues(
			dialogues.map(({ dialogue }) => dialogue.id),
			"sections.dialogue",
		),
	);

	for (const claim of episode.claims) {
		for (const sourceId of claim.source_ids) {
			if (!sourceIds.has(sourceId)) {
				issues.push({
					code: "broken_source_ref",
					path: `claims.${claim.id}.source_ids`,
					message: `source ${sourceId} does not exist`,
				});
			}
		}
	}

	for (const visual of episode.visuals) {
		if (visual.asset_ref && !assetIds.has(visual.asset_ref)) {
			issues.push({
				code: "missing_visual_asset",
				path: `visuals.${visual.id}.asset_ref`,
				message: `asset ${visual.asset_ref} does not exist`,
			});
		}
		if (visual.source_ref && !sourceIds.has(visual.source_ref)) {
			issues.push({
				code: "broken_source_ref",
				path: `visuals.${visual.id}.source_ref`,
				message: `source ${visual.source_ref} does not exist`,
			});
		}
		for (const [key, value] of Object.entries(visual.props)) {
			if (typeof value === "string" && value.length > 180) {
				issues.push({
					code: "visual_text_overflow",
					path: `visuals.${visual.id}.props.${key}`,
					message: "visual text exceeds 180 characters",
				});
			}
		}
		for (const element of visual.elements) {
			if (
				element.x + element.width > 0.95 ||
				element.y + element.height > 0.95 ||
				element.x < 0.05 ||
				element.y < 0.05
			) {
				issues.push({
					code: "unsafe_area_violation",
					path: `visuals.${visual.id}.elements.${element.id}`,
					message: "element crosses the 5% safe area",
				});
			}
		}
		for (let index = 0; index < visual.elements.length; index++) {
			const left = visual.elements[index];
			if (!left) continue;
			for (
				let otherIndex = index + 1;
				otherIndex < visual.elements.length;
				otherIndex++
			) {
				const right = visual.elements[otherIndex];
				if (!right || !boxesOverlap(left, right)) continue;
				issues.push({
					code: "element_overlap",
					path: `visuals.${visual.id}.elements`,
					message: `${left.id} overlaps ${right.id}`,
				});
			}
		}
	}

	for (const { dialogue } of dialogues) {
		if (dialogue.visual_ref && !visualIds.has(dialogue.visual_ref)) {
			issues.push({
				code: "broken_visual_ref",
				path: `dialogue.${dialogue.id}.visual_ref`,
				message: `visual ${dialogue.visual_ref} does not exist`,
			});
		}
		const subtitle = dialogue.subtitle ?? dialogue.text;
		if (subtitle.length > 84) {
			issues.push({
				code: "subtitle_overflow",
				path: `dialogue.${dialogue.id}.subtitle`,
				message: "subtitle exceeds 84 characters",
			});
		}
	}

	if (episode.thumbnail.lines.some((line) => line.length > 32)) {
		issues.push({
			code: "thumbnail_text_overflow",
			path: "thumbnail.lines",
			message: "thumbnail line exceeds 32 characters",
		});
	}
	if (
		episode.thumbnail.background_asset_ref &&
		!assetIds.has(episode.thumbnail.background_asset_ref)
	) {
		issues.push({
			code: "missing_visual_asset",
			path: "thumbnail.background_asset_ref",
			message: `asset ${episode.thumbnail.background_asset_ref} does not exist`,
		});
	}

	return issues;
}

export function buildTimeline(
	episode: Episode,
	durationMsByDialogue: Readonly<Record<string, number>>,
): EpisodeTimelineItem[] {
	let startMs = 0;
	let startFrame = 0;
	const timeline: EpisodeTimelineItem[] = [];
	for (const { section, dialogue } of allDialogues(episode)) {
		const durationMs = durationMsByDialogue[dialogue.id];
		if (!durationMs || durationMs <= 0) {
			throw new Error(`missing measured audio duration for ${dialogue.id}`);
		}
		const durationFrames = Math.max(
			1,
			Math.round((durationMs / 1000) * episode.fps),
		);
		timeline.push({
			sectionId: section.id,
			dialogueId: dialogue.id,
			startMs,
			endMs: startMs + durationMs,
			startFrame,
			endFrame: startFrame + durationFrames,
		});
		startMs += durationMs;
		startFrame += durationFrames;
	}
	return timeline;
}

function formatClock(milliseconds: number): string {
	const totalSeconds = Math.floor(milliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
		: `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSrtClock(milliseconds: number): string {
	const hours = Math.floor(milliseconds / 3_600_000);
	const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
	const seconds = Math.floor((milliseconds % 60_000) / 1000);
	const millis = Math.floor(milliseconds % 1000);
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function buildScriptMaster(episode: Episode): string {
	return `${episode.sections
		.map(
			(section) =>
				`## ${section.title}\n\n${section.dialogue
					.map((dialogue) => `${dialogue.speaker}: ${dialogue.text}`)
					.join("\n\n")}`,
		)
		.join("\n\n")}\n`;
}

export function buildYouTubeMetadata(episode: Episode): string {
	const tags =
		episode.metadata.tags.length > 0 ? episode.metadata.tags.join(", ") : "";
	return `# ${episode.metadata.title}\n\n${episode.metadata.description}\n\n${tags ? `Tags: ${tags}\n` : ""}`;
}

export function buildChapters(
	episode: Episode,
	timeline: EpisodeTimelineItem[],
): string {
	const byDialogue = new Map(timeline.map((item) => [item.dialogueId, item]));
	return `${episode.sections
		.map((section) => {
			const first = section.dialogue[0];
			if (!first) throw new Error(`section ${section.id} has no dialogue`);
			const timing = byDialogue.get(first.id);
			if (!timing) throw new Error(`timeline is missing ${first.id}`);
			return `${formatClock(timing.startMs)} ${section.title}`;
		})
		.join("\n")}\n`;
}

export function buildSubtitles(
	episode: Episode,
	timeline: EpisodeTimelineItem[],
): string {
	const dialogueById = new Map(
		allDialogues(episode).map(({ dialogue }) => [dialogue.id, dialogue]),
	);
	return `${timeline
		.map((item, index) => {
			const dialogue = dialogueById.get(item.dialogueId);
			if (!dialogue)
				throw new Error(`dialogue ${item.dialogueId} does not exist`);
			return `${index + 1}\n${formatSrtClock(item.startMs)} --> ${formatSrtClock(item.endMs)}\n${dialogue.subtitle ?? dialogue.text}`;
		})
		.join("\n\n")}\n`;
}

export function extractTranslatableStrings(
	episode: Episode,
): Record<string, string> {
	const strings: Record<string, string> = {
		"metadata.title": episode.metadata.title,
		"metadata.description": episode.metadata.description,
	};
	for (const section of episode.sections) {
		strings[`sections.${section.id}.title`] = section.title;
		for (const dialogue of section.dialogue) {
			strings[`dialogue.${dialogue.id}.text`] = dialogue.text;
			strings[`dialogue.${dialogue.id}.subtitle`] =
				dialogue.subtitle ?? dialogue.text;
		}
	}
	for (const visual of episode.visuals) {
		for (const [key, value] of Object.entries(visual.props)) {
			if (typeof value === "string")
				strings[`visuals.${visual.id}.props.${key}`] = value;
		}
		for (const element of visual.elements) {
			if (element.text)
				strings[`visuals.${visual.id}.elements.${element.id}.text`] =
					element.text;
		}
	}
	for (let index = 0; index < episode.thumbnail.lines.length; index++) {
		const line = episode.thumbnail.lines[index];
		if (line) strings[`thumbnail.lines.${index}`] = line;
	}
	return strings;
}

export function auditLocalePatch(
	episode: Episode,
	patch: LocalePatch,
): EpisodeAuditIssue[] {
	const expected = extractTranslatableStrings(episode);
	const issues: EpisodeAuditIssue[] = [];
	for (const key of Object.keys(expected)) {
		if (!(key in patch.strings)) {
			issues.push({
				code: "missing_locale_key",
				path: `locales.${patch.locale}.${key}`,
				message: `locale patch is missing ${key}`,
			});
		}
	}
	for (const key of Object.keys(patch.strings)) {
		if (!(key in expected)) {
			issues.push({
				code: "unknown_locale_key",
				path: `locales.${patch.locale}.${key}`,
				message: `locale patch contains unknown key ${key}`,
			});
		}
	}
	return issues;
}

export function applyLocalePatch(
	episode: Episode,
	patch: LocalePatch,
): Episode {
	const issues = auditLocalePatch(episode, patch);
	if (issues.length > 0)
		throw new Error(issues.map((issue) => issue.message).join("; "));
	const translated = structuredClone(episode);
	translated.metadata.language = patch.locale;
	translated.metadata.title =
		patch.strings["metadata.title"] ?? translated.metadata.title;
	translated.metadata.description =
		patch.strings["metadata.description"] ?? translated.metadata.description;

	for (const section of translated.sections) {
		section.title =
			patch.strings[`sections.${section.id}.title`] ?? section.title;
		for (const dialogue of section.dialogue) {
			dialogue.text =
				patch.strings[`dialogue.${dialogue.id}.text`] ?? dialogue.text;
			dialogue.subtitle =
				patch.strings[`dialogue.${dialogue.id}.subtitle`] ??
				dialogue.subtitle ??
				dialogue.text;
		}
	}
	for (const visual of translated.visuals) {
		for (const key of Object.keys(visual.props)) {
			const patchValue =
				patch.strings[`visuals.${visual.id}.props.${key}`];
			if (
				patchValue !== undefined &&
				typeof visual.props[key] === "string"
			) {
				visual.props[key] = patchValue;
			}
		}
		for (const element of visual.elements) {
			const patchValue =
				patch.strings[
					`visuals.${visual.id}.elements.${element.id}.text`
				];
			if (patchValue !== undefined && element.text !== undefined)
				element.text = patchValue;
		}
	}
	translated.thumbnail.lines = translated.thumbnail.lines.map(
		(line, index) => patch.strings[`thumbnail.lines.${index}`] ?? line,
	);
	return translated;
}

export function buildShortPlan(
	episode: Episode,
	timeline: EpisodeTimelineItem[],
): EpisodeShortPlan {
	if (!episode.shorts.enabled)
		throw new Error("short generation is disabled for this episode");
	const maxMs = episode.shorts.max_seconds * 1000;
	const selected: EpisodeTimelineItem[] = [];
	for (const item of timeline) {
		const projected =
			selected.length === 0 ? item.endMs - item.startMs : item.endMs;
		if (selected.length > 0 && projected > maxMs) break;
		selected.push(item);
	}
	const first = selected[0];
	if (!first) throw new Error("cannot build a short without dialogue");
	return {
		aspect_ratio: "9:16",
		dialogue_ids: selected.map((item) => item.dialogueId),
		section_ids: [...new Set(selected.map((item) => item.sectionId))],
		hook_dialogue_id: first.dialogueId,
		highlight_dialogue_ids: selected
			.slice(1)
			.map((item) => item.dialogueId),
		cta: "本編で続きを見る",
		duration_ms: selected.reduce(
			(sum, item) => sum + (item.endMs - item.startMs),
			0,
		),
	};
}

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => normalize(item));
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, normalize(record[key])]),
		);
	}
	return value;
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(normalize(value));
}

export function buildEpisodeManifest(
	episode: Episode,
	timeline: EpisodeTimelineItem[],
	shortPlan: EpisodeShortPlan | null,
): Record<string, unknown> {
	const episodeSha256 = createHash("sha256")
		.update(stableStringify(episode))
		.digest("hex");
	const timelineSha256 = createHash("sha256")
		.update(stableStringify(timeline))
		.digest("hex");
	return {
		schema_version: 1,
		episode_sha256: episodeSha256,
		timeline_sha256: timelineSha256,
		language: episode.metadata.language,
		fps: episode.fps,
		dialogue_count: timeline.length,
		duration_ms: timeline.at(-1)?.endMs ?? 0,
		short: shortPlan,
	};
}
