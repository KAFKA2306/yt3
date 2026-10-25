import type { KafkaVisualSystem } from "../design/kafka_visual_system.js";
import { type ChartTheme, renderChartSvg } from "./charts.js";
import { displayUnits, tspans, wrapDisplay, xml } from "./display_text.js";
import type { ByosanFeatureSegment, ByosanStatColor } from "./feature_spec.js";
import type { ByosanProductionConfig } from "./production_config.js";
import type { ByosanRenderedStat, ByosanSceneRender } from "./scene_render.js";
import type { ByosanVisualIdentity } from "./visual_identity.js";

type FeatureProduction = ByosanProductionConfig["feature_production"];

export type SceneSvgStyle = {
	design: KafkaVisualSystem;
	feature: FeatureProduction;
	identity: ByosanVisualIdentity;
	chart: ChartTheme;
};

type SceneSvgInput = {
	segment: ByosanFeatureSegment;
	render: ByosanSceneRender;
	index: number;
	total: number;
};

function fitFontSize(
	text: string,
	fontSize: number,
	maxWidth: number,
	halfWidthUnits: number,
	letterSpacing = 0,
): number {
	const spacing = Array.from(text).length * letterSpacing;
	return Math.min(
		fontSize,
		Math.floor((maxWidth - spacing) / displayUnits(text, halfWidthUnits)),
	);
}

function statColor(
	identity: ByosanVisualIdentity,
	color: ByosanStatColor,
): string {
	switch (color) {
		case "cyan":
			return identity.brandAccent;
		case "amber":
			return identity.warning;
		case "white":
			return identity.textPrimary;
		case "muted":
			return identity.textMuted;
	}
}

function statCard(
	stat: ByosanRenderedStat,
	x: number,
	y: number,
	width: number,
	style: SceneSvgStyle,
): string {
	const { design, feature: F } = style;
	const landscape = design.landscape;
	const color = statColor(style.identity, stat.color);
	const valueUnits = displayUnits(stat.value, F.captions.half_width_units);
	const compactValue = valueUnits > F.scene.stat_value_compact_threshold_units;
	const tierSize = compactValue
		? landscape.stat_cards.value_compact_font_size
		: valueUnits > F.scene.stat_value_medium_threshold_units
			? landscape.stat_cards.value_medium_font_size
			: landscape.stat_cards.value_short_font_size;
	const valueLines = wrapDisplay(
		stat.value,
		compactValue
			? F.scene.stat_value_compact_wrap_units
			: F.scene.stat_value_wrap_units,
		F.captions.half_width_units,
	).slice(0, F.scene.stat_value_max_lines);
	const textX = x + landscape.stat_cards.padding_left;
	const innerWidth =
		width -
		landscape.stat_cards.padding_left -
		landscape.stat_cards.padding_right;
	const valueSize = Math.min(
		tierSize,
		...valueLines.map((line) =>
			Math.floor(innerWidth / displayUnits(line, F.captions.half_width_units)),
		),
	);
	const labelSize = fitFontSize(
		stat.label,
		landscape.stat_cards.label_font_size,
		innerWidth,
		F.captions.half_width_units,
		landscape.stat_cards.label_letter_spacing,
	);
	const detailSize = fitFontSize(
		stat.detail,
		landscape.stat_cards.detail_font_size,
		innerWidth,
		F.captions.half_width_units,
	);
	return `
			<g>
				<rect x="${x}" y="${y}" width="${width}" height="${landscape.stat_cards.height}" rx="${landscape.stat_cards.radius}" fill="${landscape.stat_cards.fill}" fill-opacity="${landscape.stat_cards.fill_opacity}" stroke="${color}" stroke-opacity="${landscape.stat_cards.stroke_opacity}" stroke-width="${landscape.stat_cards.stroke_width}"/>
				<rect x="${x}" y="${y}" width="${landscape.stat_cards.accent_width}" height="${landscape.stat_cards.accent_height}" rx="${landscape.stat_cards.accent_radius}" fill="${color}"/>
				<text x="${textX}" y="${y + landscape.stat_cards.label_baseline_offset}" class="stat-label" style="font-size:${labelSize}px">${xml(stat.label)}</text>
				<text x="${textX}" y="${y + landscape.stat_cards.value_baseline_offset}" class="stat-value" font-size="${valueSize}" fill="${color}">${tspans(valueLines, textX, y + landscape.stat_cards.value_baseline_offset, landscape.stat_cards.value_line_height)}</text>
				<text x="${textX}" y="${y + landscape.stat_cards.detail_baseline_offset}" class="stat-detail" style="font-size:${detailSize}px">${xml(stat.detail)}</text>
			</g>`;
}

function dataRegionContent(
	render: ByosanSceneRender,
	style: SceneSvgStyle,
): string {
	const region = style.design.landscape.data_region;
	switch (render.kind) {
		case "stat_cards": {
			const cardGap = style.design.landscape.stat_cards.gap;
			const cardWidth = Math.floor(
				(region.width - cardGap * (render.stats.length - 1)) /
					render.stats.length,
			);
			return render.stats
				.map((stat, cardIndex) =>
					statCard(
						stat,
						region.x + cardIndex * (cardWidth + cardGap),
						region.y,
						cardWidth,
						style,
					),
				)
				.join("");
		}
		case "chart":
			return `<g transform="translate(${region.x},${region.y})">${renderChartSvg(render.chart, style.chart, { width: region.width, height: region.height })}</g>`;
		case "question":
		case "none":
			return "";
	}
}

export function renderSceneSvg(
	{ segment, render, index, total }: SceneSvgInput,
	style: SceneSvgStyle,
): string {
	const { design, feature: F, identity } = style;
	const LANDSCAPE = design.landscape;
	const WIDTH = design.canvas.landscape.width;
	const HEIGHT = design.canvas.landscape.height;
	const FONT = design.typography.japanese;
	const headlineLines = wrapDisplay(
		segment.headline,
		F.scene.headline_wrap_units,
		F.captions.half_width_units,
	).slice(0, LANDSCAPE.headline.max_lines);
	const compactHeadline = headlineLines.some(
		(line) =>
			displayUnits(line, F.captions.half_width_units) >
			F.scene.headline_compact_threshold_units,
	);
	const headlineSize = compactHeadline
		? LANDSCAPE.headline.compact_font_size
		: LANDSCAPE.headline.default_font_size;
	const headlineLineHeight = compactHeadline
		? LANDSCAPE.headline.compact_line_height
		: LANDSCAPE.headline.default_line_height;
	const speakerColor =
		segment.speaker === "ずんだもん"
			? design.colors.success
			: identity.secondaryAccent;
	const accent =
		segment.emotion === "caution" || segment.emotion === "serious"
			? identity.warning
			: identity.primaryAccent;
	const emotionLabel = F.emotion_labels[segment.emotion];
	const Q = F.scene.question_mark;
	const questionMark =
		render.kind === "question"
			? `<text x="${LANDSCAPE.chart_region.x + LANDSCAPE.chart_region.width - Q.right_inset}" y="${LANDSCAPE.chart_region.y + Q.baseline_offset}" font-family="${FONT}" font-size="${Q.font_size}" font-weight="${design.typography.weights.headline}" fill="${identity.primaryAccent}" fill-opacity="${Q.opacity}">?</text>`
			: "";
	const sectionSize = fitFontSize(
		segment.section,
		LANDSCAPE.section_label.font_size,
		LANDSCAPE.speaker_chip.x - LANDSCAPE.section_label.x,
		F.captions.half_width_units,
		LANDSCAPE.section_label.letter_spacing,
	);
	const subheadlineSize = fitFontSize(
		segment.subheadline,
		LANDSCAPE.subheadline.font_size,
		LANDSCAPE.subheadline.max_width,
		F.captions.half_width_units,
	);
	const sourceText = `${F.scene.source_label}  ${segment.source}`;
	const sourceSize = fitFontSize(
		sourceText,
		LANDSCAPE.source.font_size,
		LANDSCAPE.source.max_width,
		F.captions.half_width_units,
	);
	const P = F.scene.speaker_pointer;
	const characterX = LANDSCAPE.character_region.x;
	const characterBottom =
		LANDSCAPE.character_region.y + LANDSCAPE.character_region.height;
	return `
	<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<style>
				text { font-family: '${FONT}', sans-serif; }
				.brand { fill:${design.colors.text_primary}; font-size:${LANDSCAPE.brand_chip.font_size}px; font-weight:${LANDSCAPE.brand_chip.font_weight}; letter-spacing:${LANDSCAPE.brand_chip.letter_spacing}px; }
				.section { fill:${design.colors.brand_accent}; font-size:${LANDSCAPE.section_label.font_size}px; font-weight:${LANDSCAPE.section_label.font_weight}; letter-spacing:${LANDSCAPE.section_label.letter_spacing}px; }
				.headline { fill:${design.colors.text_primary}; font-weight:${LANDSCAPE.headline.font_weight}; letter-spacing:${LANDSCAPE.headline.letter_spacing}px; }
				.subheadline { fill:${design.colors.text_secondary}; font-size:${LANDSCAPE.subheadline.font_size}px; font-weight:${LANDSCAPE.subheadline.font_weight}; }
				.stat-label { fill:${design.colors.text_secondary}; font-size:${LANDSCAPE.stat_cards.label_font_size}px; font-weight:${LANDSCAPE.stat_cards.label_font_weight}; letter-spacing:${LANDSCAPE.stat_cards.label_letter_spacing}px; }
				.stat-value { font-weight:${design.typography.weights.headline}; letter-spacing:${F.scene.stat_value_letter_spacing_px}px; }
				.stat-detail { fill:${design.colors.text_muted}; font-size:${LANDSCAPE.stat_cards.detail_font_size}px; font-weight:${LANDSCAPE.stat_cards.detail_font_weight}; }
				.source { fill:${design.colors.text_muted}; font-size:${LANDSCAPE.source.font_size}px; font-weight:${LANDSCAPE.source.font_weight}; }
			</style>
		</defs>
		<rect width="${WIDTH}" height="${HEIGHT}" fill="${design.colors.background}"/>
		<rect x="${LANDSCAPE.outer_frame.x}" y="${LANDSCAPE.outer_frame.y}" width="${LANDSCAPE.outer_frame.width}" height="${LANDSCAPE.outer_frame.height}" rx="${LANDSCAPE.outer_frame.radius}" fill="none" stroke="${LANDSCAPE.outer_frame.color}" stroke-opacity="${LANDSCAPE.outer_frame.opacity}" stroke-width="${LANDSCAPE.outer_frame.stroke_width}"/>
		<rect x="${LANDSCAPE.caption_band.x}" y="${LANDSCAPE.caption_band.y}" width="${LANDSCAPE.caption_band.width}" height="${LANDSCAPE.caption_band.height}" fill="${LANDSCAPE.caption_band.color}" fill-opacity="${LANDSCAPE.caption_band.opacity}"/>
		<rect x="${LANDSCAPE.accent_rail.x}" y="${LANDSCAPE.accent_rail.y}" width="${LANDSCAPE.accent_rail.width}" height="${LANDSCAPE.accent_rail.height}" fill="${accent}"/>
		<g transform="translate(${LANDSCAPE.brand_chip.x},${LANDSCAPE.brand_chip.y})">
			<rect width="${LANDSCAPE.brand_chip.width}" height="${LANDSCAPE.brand_chip.height}" rx="${LANDSCAPE.brand_chip.radius}" fill="${design.colors.surface}" stroke="${LANDSCAPE.outer_frame.color}" stroke-width="${design.stroke.default}"/>
			<text x="${LANDSCAPE.brand_chip.text_x - LANDSCAPE.brand_chip.x}" y="${LANDSCAPE.brand_chip.baseline_y - LANDSCAPE.brand_chip.y}" class="brand">${xml(F.brand_label)}</text>
		</g>
		<text x="${LANDSCAPE.section_counter.x}" y="${LANDSCAPE.section_counter.baseline_y}" class="section">${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>
		<rect x="${LANDSCAPE.progress.x}" y="${LANDSCAPE.progress.y}" width="${LANDSCAPE.progress.width}" height="${LANDSCAPE.progress.height}" rx="${LANDSCAPE.progress.radius}" fill="${LANDSCAPE.progress.track}"/>
		<rect x="${LANDSCAPE.progress.x}" y="${LANDSCAPE.progress.y}" width="${Math.round(LANDSCAPE.progress.width * ((index + 1) / total))}" height="${LANDSCAPE.progress.height}" rx="${LANDSCAPE.progress.radius}" fill="${accent}"/>
		<text x="${LANDSCAPE.section_label.x}" y="${LANDSCAPE.section_label.baseline_y}" class="section" style="font-size:${sectionSize}px">${xml(segment.section)}</text>
		<text x="${LANDSCAPE.headline.x}" y="${LANDSCAPE.headline.baseline_y}" class="headline" font-size="${headlineSize}">${tspans(headlineLines, LANDSCAPE.headline.x, LANDSCAPE.headline.baseline_y, headlineLineHeight)}</text>
		<text x="${LANDSCAPE.subheadline.x}" y="${headlineLines.length > 1 ? LANDSCAPE.subheadline.two_line_baseline_y : LANDSCAPE.subheadline.one_line_baseline_y}" class="subheadline" style="font-size:${subheadlineSize}px">${xml(segment.subheadline)}</text>
		${dataRegionContent(render, style)}
		${questionMark}
			<path d="M${characterX + P.start_x} ${characterBottom - P.start_bottom} C${characterX + P.control1_x} ${characterBottom - P.control1_bottom} ${characterX + P.control2_x} ${characterBottom - P.control2_bottom} ${characterX + P.end_x} ${characterBottom - P.end_bottom}" fill="none" stroke="${speakerColor}" stroke-opacity="${P.stroke_opacity}" stroke-width="${P.stroke_width}" stroke-linecap="round"/>
			<circle cx="${characterX + P.start_x}" cy="${characterBottom - P.start_bottom}" r="${P.dot_radius}" fill="${speakerColor}"/>
		<g transform="translate(${LANDSCAPE.speaker_chip.x},${LANDSCAPE.speaker_chip.y})">
			<rect width="${LANDSCAPE.speaker_chip.width}" height="${LANDSCAPE.speaker_chip.height}" rx="${LANDSCAPE.speaker_chip.radius}" fill="${design.colors.surface}" stroke="${speakerColor}" stroke-width="${LANDSCAPE.speaker_chip.stroke_width}"/>
			<text x="${LANDSCAPE.speaker_chip.text_x - LANDSCAPE.speaker_chip.x}" y="${LANDSCAPE.speaker_chip.baseline_y - LANDSCAPE.speaker_chip.y}" font-size="${LANDSCAPE.speaker_chip.font_size}" font-weight="${LANDSCAPE.speaker_chip.font_weight}" fill="${speakerColor}">${xml(segment.speaker)}</text>
			<text x="${LANDSCAPE.speaker_chip.emotion_x - LANDSCAPE.speaker_chip.x}" y="${LANDSCAPE.speaker_chip.emotion_baseline_y - LANDSCAPE.speaker_chip.y}" text-anchor="end" font-size="${LANDSCAPE.speaker_chip.emotion_font_size}" font-weight="${LANDSCAPE.speaker_chip.emotion_font_weight}" fill="${design.colors.text_secondary}">${xml(emotionLabel)}</text>
		</g>
		<text x="${LANDSCAPE.source.x}" y="${LANDSCAPE.source.baseline_y}" class="source" style="font-size:${sourceSize}px">${F.scene.source_label}  ${xml(segment.source)}</text>
	</svg>`;
}
