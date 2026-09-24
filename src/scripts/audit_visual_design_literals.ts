import path from "node:path";
import fs from "fs-extra";

export type VisualLiteralViolation = {
	file: string;
	line: number;
	rule: string;
	text: string;
};

const rules: Array<[string, RegExp]> = [
	["direct-hex", /#[0-9A-Fa-f]{6}\b/],
	["rgba-literal", /rgba?\(/],
	[
		"percentage-layout",
		/\b(?:width|height|left|right|top|bottom)\s*:\s*["']\d+%/,
	],
	[
		"numeric-css-literal",
		/\b(?:fontSize|borderRadius|padding|margin(?:Top|Bottom|Left|Right)?)\s*:\s*\d+/,
	],
	["legacy-thumbnail-guard", /right_guard_band_px/],
	["hardcoded-canvas-constant", /\b(?:WIDTH|HEIGHT|FPS)\s*=\s*\d+/],
];

export function scanVisualDesignLiterals(
	contents: string,
	file: string,
): VisualLiteralViolation[] {
	const violations: VisualLiteralViolation[] = [];
	for (const [lineIndex, text] of contents.split("\n").entries()) {
		for (const [rule, pattern] of rules) {
			if (pattern.test(text))
				violations.push({ file, line: lineIndex + 1, rule, text: text.trim() });
		}
	}
	return violations;
}

export function auditVisualDesignLiterals(
	root = process.cwd(),
): VisualLiteralViolation[] {
	const sourceFiles = (directory: string): string[] =>
		fs
			.readdirSync(directory, { recursive: true })
			.map((entry) => String(entry))
			.filter((entry) => entry.endsWith(".ts"))
			.map((entry) => path.join(directory, entry));
	const files = [
		path.join(root, "src/scripts/produce_byosan_feature.ts"),
		...sourceFiles(path.join(root, "src/domain/media")),
		...sourceFiles(path.join(root, "src/domain/episode")),
	];
	return files.flatMap((file) =>
		scanVisualDesignLiterals(
			fs.readFileSync(file, "utf8"),
			path.relative(root, file),
		),
	);
}

if (import.meta.main) {
	const violations = auditVisualDesignLiterals();
	if (violations.length > 0) {
		for (const violation of violations)
			console.error(
				`${violation.file}:${violation.line} ${violation.rule}: ${violation.text}`,
			);
		process.exitCode = 1;
	} else {
		console.log("[visual-design-literals] PASS");
	}
}
