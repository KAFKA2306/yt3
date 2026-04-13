import { fitText } from "../../io/core.js";
import type { AppConfig, RenderPlan, Script } from "../types.js";

function fmtTime(s: number): string {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = Math.floor(s % 60);
	const ms = Math.floor((s % 1) * 100);
	return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

function getStyle(sL: number, sR: number, cfg: AppConfig) {
	const s = cfg.steps.video.subtitles || {};
	const g = cfg.global_style;
	return {
		font: s.font_name || cfg.design_tokens?.font_japanese || "Noto Sans JP",
		size: s.font_size || g.video.subtitle_size,
		color: s.primary_colour || "&HFFFFFF&",
		outlineColor: s.outline_colour || "&H000000&",
		outline: s.outline ?? 2,
		shadow: s.shadow ?? 0,
		align: s.alignment ?? 2,
		mV: s.margin_v ?? 10,
		mL: sL,
		mR: sR,
	};
}

function getLines(
	script: Script,
	durations: number[],
	maxW: number,
	baseFz: number,
	cfg: AppConfig,
): string {
	let res = "";
	let time = 0;
	const minFz = cfg.steps.video.subtitles?.min_font_size || 40;
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
	const { safeMarginL: sL = 0, safeMarginR: sR = 0 } = plan;
	const [w, h] = (config.steps.video.resolution || "1920x1080").split("x");
	const style = getStyle(sL, sR, config);
	const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${style.font},${style.size},${style.color},&H000000FF,${style.outlineColor},&H00000080,0,0,0,0,100,100,0,0,1,${style.outline},${style.shadow},${style.align},${style.mL},${style.mR},${style.mV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
	return (
		header +
		getLines(script, durations, Number(w) - sL - sR, style.size, config)
	);
}
