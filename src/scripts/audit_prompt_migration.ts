import fs from "node:fs";
import path from "node:path";
import {
	ByosanPromptInventorySchema,
	auditByosanPromptMigration,
	discoverByosanPromptInventory,
} from "../domain/byosan/prompt_migration.js";

function argValue(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv
		.slice(2)
		.find((arg) => arg.startsWith(prefix))
		?.slice(prefix.length);
}

const root = process.cwd();
const outputPath = path.resolve(
	root,
	argValue("output") ?? "audits/byosan_prompt_inventory.json",
);
const reportPath = path.resolve(
	root,
	argValue("report") ?? "audits/byosan_prompt_migration.json",
);
const previousPath = path.resolve(
	root,
	argValue("previous") ?? "audits/byosan_prompt_inventory.json",
);
const modelProfile =
	argValue("model") ??
	process.env.BYOSAN_MODEL_PROFILE ??
	process.env.GEMINI_MODEL ??
	"unconfigured";

const previous =
	fs.existsSync(previousPath) && previousPath !== outputPath
		? ByosanPromptInventorySchema.parse(
				JSON.parse(fs.readFileSync(previousPath, "utf-8")),
			)
		: fs.existsSync(outputPath)
			? ByosanPromptInventorySchema.parse(
					JSON.parse(fs.readFileSync(outputPath, "utf-8")),
				)
			: null;
const current = discoverByosanPromptInventory(root, modelProfile);
const audit = auditByosanPromptMigration(previous, current);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(current, null, 2)}\n`);
fs.writeFileSync(
	reportPath,
	`${JSON.stringify(
		{
			schemaVersion: "byosan_prompt_migration_report_v1",
			previousModelProfile: previous?.modelProfile ?? null,
			currentModelProfile: current.modelProfile,
			diff: audit.diff,
			issues: audit.issues,
		},
		null,
		2,
	)}\n`,
);

for (const issue of audit.issues) {
	const stream = issue.severity === "FAIL" ? console.error : console.warn;
	stream(`[prompt-migration] ${issue.severity} ${issue.code} ${issue.details}`);
}
console.log(
	`[prompt-migration] inventory=${path.relative(root, outputPath)} records=${current.records.length} model=${current.modelProfile}`,
);
console.log(
	`[prompt-migration] report=${path.relative(root, reportPath)} fail=${audit.issues.filter((issue) => issue.severity === "FAIL").length} warn=${audit.issues.filter((issue) => issue.severity === "WARN").length}`,
);

if (audit.issues.some((issue) => issue.severity === "FAIL")) process.exit(1);
