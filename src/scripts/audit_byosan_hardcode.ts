import fs from "fs-extra";
import yaml from "js-yaml";
import ts from "typescript";
import { z } from "zod";

export type ByosanHardcodeViolation = {
	file: string;
	line: number;
	rule: string;
	text: string;
};

const HardcodeAuditConfigSchema = z.object({
	hardcode_audit: z.object({
		targets: z.array(z.string().min(1)).min(1),
		allowed_numbers: z.array(z.number()).min(1),
		forbidden_string_patterns: z.array(z.string().min(1)).min(1),
		forbidden_identifiers: z.array(z.string().min(1)).min(1),
	}),
});

export type ByosanHardcodeAuditConfig = z.infer<
	typeof HardcodeAuditConfigSchema
>["hardcode_audit"];

export function readByosanHardcodeAuditConfig(
	configPath: string,
): ByosanHardcodeAuditConfig {
	return HardcodeAuditConfigSchema.parse(
		yaml.load(fs.readFileSync(configPath, "utf8")),
	).hardcode_audit;
}

export function scanByosanHardcode(
	contents: string,
	file: string,
	config: ByosanHardcodeAuditConfig,
): ByosanHardcodeViolation[] {
	const source = ts.createSourceFile(
		file,
		contents,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const allowedNumbers = new Set(config.allowed_numbers);
	const stringPatterns = config.forbidden_string_patterns.map(
		(pattern) => new RegExp(pattern),
	);
	const violations: ByosanHardcodeViolation[] = [];
	const report = (node: ts.Node, rule: string): void => {
		const { line } = source.getLineAndCharacterOfPosition(node.getStart());
		violations.push({
			file,
			line: line + 1,
			rule,
			text: node.getText().trim(),
		});
	};
	const visit = (node: ts.Node): void => {
		if (ts.isNumericLiteral(node) && !allowedNumbers.has(Number(node.text)))
			report(node, "numeric-literal-not-allowed");
		if (
			(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
			stringPatterns.some((pattern) => pattern.test(node.text))
		)
			report(node, "string-literal-is-setting-value");
		if (
			ts.isPropertyAccessExpression(node) &&
			config.forbidden_identifiers.includes(node.getText())
		)
			report(node, "forbidden-identifier");
		ts.forEachChild(node, visit);
	};
	visit(source);
	return violations;
}

export function auditByosanHardcode(
	root = process.cwd(),
	configPath = `${root}/config/domains/byosan_money.yaml`,
): ByosanHardcodeViolation[] {
	const config = readByosanHardcodeAuditConfig(configPath);
	return config.targets.flatMap((target) =>
		scanByosanHardcode(
			fs.readFileSync(`${root}/${target}`, "utf8"),
			target,
			config,
		),
	);
}

if (import.meta.main) {
	const violations = auditByosanHardcode();
	if (violations.length > 0) {
		for (const violation of violations)
			console.error(
				`${violation.file}:${violation.line} ${violation.rule}: ${violation.text}`,
			);
		process.exitCode = 1;
	} else {
		console.log("[byosan-hardcode] PASS");
	}
}
