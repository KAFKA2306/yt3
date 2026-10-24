export function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export function displayUnits(value: string, halfWidthUnits: number): number {
	return Array.from(value).reduce(
		(total, char) =>
			total + ((char.codePointAt(0) ?? 0) <= 0xff ? halfWidthUnits : 1),
		0,
	);
}

export function wrapDisplay(
	value: string,
	maxUnits: number,
	halfWidthUnits: number,
): string[] {
	const hardLines = value.split("\n");
	const result: string[] = [];
	for (const hardLine of hardLines) {
		let current = "";
		for (const char of Array.from(hardLine)) {
			if (
				current &&
				displayUnits(`${current}${char}`, halfWidthUnits) > maxUnits
			) {
				result.push(current);
				current = char;
			} else {
				current += char;
			}
		}
		if (current) result.push(current);
	}
	return result.length > 0 ? result : [""];
}

export function tspans(
	lines: string[],
	x: number,
	y: number,
	lineHeight: number,
): string {
	return lines
		.map(
			(line, index) =>
				`<tspan x="${x}" y="${y + index * lineHeight}">${xml(line)}</tspan>`,
		)
		.join("");
}
