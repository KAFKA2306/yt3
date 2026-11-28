import type { ByosanFeatureSegment } from "./feature_spec.js";

type EvergreenGraphicSegment = Pick<
	ByosanFeatureSegment,
	"section" | "headline" | "subheadline" | "visualType" | "stats"
>;

const esc = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");

const svgStart = (segment: EvergreenGraphicSegment): string => `
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs>
  <marker id="arrow" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" refX="12" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 Z" fill="#7BA7E1"/></marker>
  <linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="#7BA7E1"/><stop offset="1" stop-color="#B8A7E6"/></linearGradient>
</defs>
<rect width="1920" height="1080" fill="#F7F5EF"/>
<rect x="92" y="78" width="1736" height="924" rx="38" fill="#FFFFFF" stroke="#D7DEE7" stroke-width="3"/>
<rect x="92" y="78" width="20" height="924" rx="10" fill="#7BA7E1"/>
<text x="166" y="155" font-family="IBM Plex Sans JP,sans-serif" font-size="29" font-weight="700" fill="#52637A">${esc(segment.section)}</text>
<text x="166" y="244" font-family="IBM Plex Sans JP,sans-serif" font-size="51" font-weight="800" fill="#17233F">${esc(segment.headline)}</text>
<text x="166" y="300" font-family="IBM Plex Sans JP,sans-serif" font-size="30" font-weight="600" fill="#52637A">${esc(segment.subheadline)}</text>
<line x1="166" y1="338" x2="1754" y2="338" stroke="#E5EAF0" stroke-width="3"/>
`;

const svgEnd = `</svg>`;

export function buildIfThenSvg(
	segment: EvergreenGraphicSegment,
	beatIndex = 0,
): string {
	const condition = segment.stats.find((stat) => stat.label === "IF");
	const action = segment.stats.find((stat) => stat.label === "THEN");
	if (!condition || !action) {
		throw new Error("BYOSAN_EVERGREEN_IF_THEN_STATS_REQUIRED");
	}
	const ifActive = beatIndex % 2 === 0;
	const ifFill = ifActive ? "#EAF2FC" : "#F7F8FA";
	const ifStroke = ifActive ? "#7BA7E1" : "#D4DCE5";
	const thenFill = ifActive ? "#F7F8FA" : "#F1ECFA";
	const thenStroke = ifActive ? "#D4DCE5" : "#B8A7E6";
	return `${svgStart(segment)}
<rect x="180" y="390" width="650" height="420" rx="26" fill="${ifFill}" stroke="${ifStroke}" stroke-width="5"/>
<rect x="1090" y="390" width="650" height="420" rx="26" fill="${thenFill}" stroke="${thenStroke}" stroke-width="5"/>
<text x="235" y="470" font-family="IBM Plex Sans JP,sans-serif" font-size="36" font-weight="800" fill="#315C93">IF</text>
<text x="1145" y="470" font-family="IBM Plex Sans JP,sans-serif" font-size="36" font-weight="800" fill="#665697">THEN</text>
<text x="235" y="568" font-family="IBM Plex Sans JP,sans-serif" font-size="45" font-weight="800" fill="#17233F">${esc(condition.value)}</text>
<text x="235" y="638" font-family="IBM Plex Sans JP,sans-serif" font-size="30" font-weight="600" fill="#52637A">${esc(condition.detail)}</text>
<text x="1145" y="568" font-family="IBM Plex Sans JP,sans-serif" font-size="45" font-weight="800" fill="#17233F">${esc(action.value)}</text>
<text x="1145" y="638" font-family="IBM Plex Sans JP,sans-serif" font-size="30" font-weight="600" fill="#52637A">${esc(action.detail)}</text>
<line x1="858" y1="600" x2="1054" y2="600" stroke="#7BA7E1" stroke-width="13" marker-end="url(#arrow)"/>
${svgEnd}`;
}

export function buildPercentageSvg(segment: EvergreenGraphicSegment): string {
	const stat = segment.stats[0];
	if (!stat) throw new Error("BYOSAN_EVERGREEN_PERCENTAGE_STAT_REQUIRED");
	const match = stat.value.normalize("NFKC").match(/^(\d+(?:\.\d+)?)%$/u);
	if (!match) throw new Error("BYOSAN_EVERGREEN_PERCENTAGE_VALUE_INVALID");
	const percentage = Number(match[1]);
	if (percentage < 0 || percentage > 100) {
		throw new Error("BYOSAN_EVERGREEN_PERCENTAGE_VALUE_INVALID");
	}
	const width = Math.round(1400 * (percentage / 100));
	return `${svgStart(segment)}
<text x="205" y="515" font-family="IBM Plex Sans JP,sans-serif" font-size="140" font-weight="900" fill="#315C93">${esc(stat.value)}</text>
<text x="650" y="448" font-family="IBM Plex Sans JP,sans-serif" font-size="42" font-weight="800" fill="#17233F">${esc(stat.label)}</text>
<text x="650" y="516" font-family="IBM Plex Sans JP,sans-serif" font-size="31" font-weight="600" fill="#52637A">${esc(stat.detail)}</text>
<rect x="205" y="652" width="1400" height="46" rx="23" fill="#E5EAF0"/>
<rect x="205" y="652" width="${width}" height="46" rx="23" fill="url(#bar)"/>
<text x="205" y="762" font-family="IBM Plex Sans JP,sans-serif" font-size="28" font-weight="700" fill="#52637A">比較対象となった期間の割合</text>
${svgEnd}`;
}

export function buildComparisonBarsSvg(
	segment: EvergreenGraphicSegment,
	beatIndex = 0,
): string {
	if (segment.stats.length < 2) {
		throw new Error("BYOSAN_EVERGREEN_COMPARISON_STATS_REQUIRED");
	}
	const amounts = segment.stats.map((stat) => {
		const value = Number(
			stat.value.normalize("NFKC").replaceAll(/[^0-9.]/gu, ""),
		);
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error("BYOSAN_EVERGREEN_COMPARISON_VALUE_INVALID");
		}
		return value;
	});
	const maximum = Math.max(...amounts);
	const active = beatIndex % segment.stats.length;
	const rows = segment.stats
		.map((stat, index) => {
			const amount = amounts[index];
			if (amount === undefined)
				throw new Error("BYOSAN_EVERGREEN_VALUE_MISSING");
			const y = 430 + index * 135;
			const width = Math.round((amount / maximum) * 1020);
			const color = index === active ? "url(#bar)" : "#C9D6E4";
			return `<text x="205" y="${y}" font-family="IBM Plex Sans JP,sans-serif" font-size="31" font-weight="700" fill="#17233F">${esc(stat.label)}</text>
<rect x="545" y="${y - 34}" width="1020" height="46" rx="23" fill="#E5EAF0"/>
<rect x="545" y="${y - 34}" width="${width}" height="46" rx="23" fill="${color}"/>
<text x="1600" y="${y}" text-anchor="end" font-family="IBM Plex Sans JP,sans-serif" font-size="31" font-weight="800" fill="#17233F">${esc(stat.value)}</text>
<text x="545" y="${y + 38}" font-family="IBM Plex Sans JP,sans-serif" font-size="24" font-weight="600" fill="#52637A">${esc(stat.detail)}</text>`;
		})
		.join("\n");
	return `${svgStart(segment)}${rows}${svgEnd}`;
}

export function buildNarrativeSvg(
	segment: EvergreenGraphicSegment,
	beatIndex = 0,
): string {
	if (segment.stats.length === 0) {
		return `${svgStart(segment)}
<rect x="190" y="405" width="650" height="205" rx="28" fill="#EAF2FC" stroke="#7BA7E1" stroke-width="4"/>
<rect x="1080" y="405" width="650" height="205" rx="28" fill="#F1ECFA" stroke="#B8A7E6" stroke-width="4"/>
<text x="265" y="528" font-family="IBM Plex Sans JP,sans-serif" font-size="46" font-weight="800" fill="#17233F">安く買いたい</text>
<text x="1150" y="528" font-family="IBM Plex Sans JP,sans-serif" font-size="46" font-weight="800" fill="#665697">底値まで待ちたい</text>
<line x1="840" y1="475" x2="884" y2="475" stroke="#7BA7E1" stroke-width="8" marker-end="url(#arrow)"/>
<line x1="1080" y1="545" x2="1036" y2="545" stroke="#B8A7E6" stroke-width="8" marker-end="url(#arrow)"/>
<circle cx="960" cy="510" r="70" fill="#FFFFFF" stroke="#FFD8A8" stroke-width="6"/>
<text x="960" y="500" text-anchor="middle" font-family="IBM Plex Sans JP,sans-serif" font-size="27" font-weight="800" fill="#17233F">同じ</text>
<text x="960" y="538" text-anchor="middle" font-family="IBM Plex Sans JP,sans-serif" font-size="27" font-weight="800" fill="#17233F">資金</text>
<rect x="550" y="700" width="820" height="112" rx="24" fill="#FFF2DF" stroke="#FFD8A8" stroke-width="4"/>
<text x="960" y="770" text-anchor="middle" font-family="IBM Plex Sans JP,sans-serif" font-size="42" font-weight="800" fill="#17233F">買付判断が停止</text>
${svgEnd}`;
	}
	const rows = segment.stats
		.map((stat, index) => {
			const y = 386 + index * 174;
			const active = index === beatIndex % segment.stats.length;
			const fill = active
				? stat.color === "amber"
					? "#FFF2DF"
					: "#EAF2FC"
				: "#F7F8FA";
			const stroke = active
				? stat.color === "amber"
					? "#FFD8A8"
					: "#7BA7E1"
				: "#D4DCE5";
			return `<rect x="190" y="${y}" width="1540" height="142" rx="22" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
<text x="235" y="${y + 48}" font-family="IBM Plex Sans JP,sans-serif" font-size="27" font-weight="700" fill="#52637A">${esc(stat.label)}</text>
<text x="630" y="${y + 61}" font-family="IBM Plex Sans JP,sans-serif" font-size="39" font-weight="800" fill="#17233F">${esc(stat.value)}</text>
<text x="630" y="${y + 105}" font-family="IBM Plex Sans JP,sans-serif" font-size="25" font-weight="600" fill="#52637A">${esc(stat.detail)}</text>`;
		})
		.join("\n");
	return `${svgStart(segment)}${rows}${svgEnd}`;
}

export function evergreenGraphicSvg(
	segment: EvergreenGraphicSegment,
	beatIndex = 0,
): string {
	switch (segment.visualType) {
		case "if_then":
			return buildIfThenSvg(segment, beatIndex);
		case "percentage_bar":
			return buildPercentageSvg(segment);
		case "comparison_bars":
			return buildComparisonBarsSvg(segment, beatIndex);
		default:
			return buildNarrativeSvg(segment, beatIndex);
	}
}
