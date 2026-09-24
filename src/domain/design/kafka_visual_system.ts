import path from "node:path";
import fs from "fs-extra";
import {
	type KafkaVisualSystem,
	KafkaVisualSystemSchema,
	RectSchema,
} from "./schema.js";

export type { KafkaVisualSystem } from "./schema.js";

export const KAFKA_VISUAL_SYSTEM_PATH = path.join(
	process.cwd(),
	"config/design/kafka_visual_system_v1.json",
);

function overlaps(
	left: { x: number; y: number; width: number; height: number },
	right: { x: number; y: number; width: number; height: number },
): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
}

function inside(
	rect: { x: number; y: number; width: number; height: number },
	canvas: { width: number; height: number },
): boolean {
	return (
		rect.x >= 0 &&
		rect.y >= 0 &&
		rect.x + rect.width <= canvas.width &&
		rect.y + rect.height <= canvas.height
	);
}

export function validateDesignSystem(input: unknown): KafkaVisualSystem {
	return KafkaVisualSystemSchema.parse(input);
}

export function assertDesignSystemGeometry(design: KafkaVisualSystem): void {
	const landscape = design.canvas.landscape;
	const L = design.landscape;
	for (const rect of [
		L.outer_frame,
		L.accent_rail,
		L.caption_band,
		L.data_region,
		L.chart_region,
		L.character_region,
	]) {
		if (!inside(rect, landscape))
			throw new Error(
				`DESIGN_GEOMETRY_OUT_OF_BOUNDS: landscape:${JSON.stringify(rect)}`,
			);
	}
	if (overlaps(L.data_region, L.character_region))
		throw new Error("DESIGN_GEOMETRY_OVERLAP: landscape data and character");
	if (L.character_region.y + L.character_region.height > L.caption_band.y)
		throw new Error("DESIGN_GEOMETRY_OVERLAP: landscape character and caption");
	if (L.source.baseline_y >= L.caption_band.y)
		throw new Error("DESIGN_GEOMETRY_SOURCE_IN_CAPTION_BAND");
	const thirdCardWidth = L.stat_cards.widths[2];
	if (
		thirdCardWidth === undefined ||
		thirdCardWidth * 3 + L.stat_cards.gap * 2 !== L.data_region.width
	)
		throw new Error("DESIGN_GEOMETRY_STAT_CARDS_DO_NOT_FIT");
	if (L.subtitle.margin_left + L.subtitle.margin_right >= landscape.width)
		throw new Error("DESIGN_GEOMETRY_SUBTITLE_HAS_NO_WIDTH");

	const thumbnail = design.canvas.thumbnail;
	const T = design.thumbnail;
	for (const rect of [
		T.outer_frame,
		T.accent_rail,
		T.title_zone,
		T.character_zone,
	]) {
		if (!inside(rect, thumbnail))
			throw new Error(
				`DESIGN_GEOMETRY_OUT_OF_BOUNDS: thumbnail:${JSON.stringify(rect)}`,
			);
	}
	if (overlaps(T.title_zone, T.character_zone))
		throw new Error("DESIGN_GEOMETRY_OVERLAP: thumbnail title and character");
	if (T.title_zone.max_lines > 3)
		throw new Error("DESIGN_GEOMETRY_THUMBNAIL_TITLE_LINES");

	const shorts = design.canvas.shorts;
	const S = design.shorts;
	for (const rect of [
		S.outer_frame,
		S.accent_rail,
		S.main_visual_zone,
		S.caption_band,
		S.caption_text_zone,
	]) {
		if (!inside(rect, shorts))
			throw new Error(
				`DESIGN_GEOMETRY_OUT_OF_BOUNDS: shorts:${JSON.stringify(rect)}`,
			);
	}
	if (overlaps(S.main_visual_zone, S.caption_band))
		throw new Error("DESIGN_GEOMETRY_OVERLAP: shorts visual and caption");
	if (
		S.caption_band.y + S.caption_band.height >
		shorts.height - S.bottom_reserved_height
	)
		throw new Error("DESIGN_GEOMETRY_SHORTS_RESERVED_ZONE");
}

let cached: KafkaVisualSystem | undefined;
export function getKafkaVisualSystem(): KafkaVisualSystem {
	if (!cached) {
		cached = validateDesignSystem(fs.readJsonSync(KAFKA_VISUAL_SYSTEM_PATH));
		assertDesignSystemGeometry(cached);
	}
	return cached;
}

export function rect(value: unknown): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	return RectSchema.parse(value);
}
