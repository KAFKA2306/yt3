import { fitText } from "../../io/core.js";
import { getKafkaVisualSystem } from "../design/kafka_visual_system.js";
import type { AppConfig, RenderPlan, Script } from "../types.js";

function fmtTime(s: number): string {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = Math.floor(s % 60);
	const ms = Math.floor((s % 1) * 100);
	return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

function hexToAss(hex: string): string {
	return `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`;
}

function getStyle() {
	const design = getKafkaVisualSystem();
	const s = design.landscape.subtitle;
	return {
		font: design.typography.japanese,
		size: s.font_size,
		color: hexToAss(s.color),
		outlineColor: hexToAss(s.outline_color),
		outline: s.outline_width,
		shadow: s.shadow,
		align: 2,
		mV: s.margin_bottom,
		mL: s.margin_left,
		mR: s.margin_right,
	};
}

function getLines(
	script: Script,
	durations: number[],
	maxW: number,
	baseFz: number,
): string {
	let res = "";
	let time = 0;
	const minFz = getKafkaVisualSystem().landscape.subtitle.min_font_size;
	const lines = script.lines || [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const dur = durations[i] ?? 0;
		const { formattedText: txt, fontSize: fz } = fitText(
			line.text,
			baseFz,
			maxW,
			minFz,
		);
		const content = fz !== baseFz ? `{\\fs${fz}}${txt}` : txt;
		res += `Dialogue: 0,${fmtTime(time)},${fmtTime(time + dur)},Default,,0,0,0,,${content.replace(/\n/g, "\\N")}\n`;
		time += dur;
	}
	return res;
}

export function generateASS(
	script: Script,
	durations: number[],
	plan: RenderPlan,
	config: AppConfig,
): string {
	const design = getKafkaVisualSystem();
	const w = String(design.canvas.landscape.width);
	const h = String(design.canvas.landscape.height);
	const style = getStyle();
	const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${style.font},${style.size},${style.color},&H000000FF,${style.outlineColor},&H00000080,0,0,0,0,100,100,0,0,1,${style.outline},${style.shadow},${style.align},${style.mL},${style.mR},${style.mV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
	return (
		header +
		getLines(script, durations, Number(w) - style.mL - style.mR, style.size)
	);
}
