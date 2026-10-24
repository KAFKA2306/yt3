import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { getByosanProductionConfig } from "./production_config.js";

export type FontMatch = { family: string; file: string };

export function byosanFontDir(): string {
	return path.join(
		process.cwd(),
		path.dirname(getByosanProductionConfig().global_style.font_path),
	);
}

export function requiredFontFamilies(stacks: readonly string[]): string[] {
	return [...new Set(stacks.map((stack) => stack.replace(/,.*$/, "").trim()))];
}

export function fontconfigXml(fontDir: string): string {
	return `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
	<include ignore_missing="yes">/etc/fonts/fonts.conf</include>
	<dir>${fontDir}</dir>
</fontconfig>
`;
}

export function byosanFontconfigEnv(): { FONTCONFIG_FILE: string } {
	const configPath = path.join(
		process.cwd(),
		"node_modules/.cache/byosan/byosan.fonts.conf",
	);
	fs.outputFileSync(configPath, fontconfigXml(byosanFontDir()));
	return { FONTCONFIG_FILE: configPath };
}

export function parseFcMatch(output: string): FontMatch {
	const [family, file] = output.trimEnd().split("\t");
	return { family: family ?? "", file: file ?? "" };
}

export function matchFontFamily(family: string): FontMatch {
	return parseFcMatch(
		execFileSync("fc-match", ["-f", "%{family[0]}\t%{file}", family], {
			encoding: "utf8",
		}),
	);
}

export function fontMatchProblem(
	family: string,
	match: FontMatch,
	fontDir: string,
): string | undefined {
	if (match.family !== family)
		return `${family} -> ${match.family || "(no match)"}`;
	if (!match.file.startsWith(`${fontDir}${path.sep}`))
		return `${family} -> ${match.file}`;
	return undefined;
}
