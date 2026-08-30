import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

type TaskDefinition = {
	dir?: string;
	cmds?: Array<string | { cmd?: string }>;
};

type Taskfile = {
	tasks?: Record<string, TaskDefinition>;
};

type Failure = {
	source: string;
	message: string;
};

type PowerMacroWeek = {
	week_end?: string;
	source_report?: string;
};

type PowerMacroHistory = {
	schema_version?: number;
	domain?: string;
	weeks?: PowerMacroWeek[];
};

const ROOT = process.cwd();
const failures: Failure[] = [];

function exists(relativePath: string): boolean {
	return fs.existsSync(path.resolve(ROOT, relativePath));
}

function record(source: string, message: string) {
	failures.push({ source, message });
}

function loadText(relativePath: string): string {
	const absolutePath = path.resolve(ROOT, relativePath);
	if (!fs.existsSync(absolutePath)) {
		record(relativePath, "file does not exist");
		return "";
	}
	return fs.readFileSync(absolutePath, "utf-8");
}

function localExecutablePaths(command: string): string[] {
	const matches = command.matchAll(
		/((?:\.claude|src|scripts|hooks)\/[A-Za-z0-9_./-]+\.(?:ts|js|mjs|cjs|py|sh))/g,
	);
	return [...matches].flatMap((match) => (match[1] ? [match[1]] : []));
}

function auditTaskfile(): Set<string> {
	const raw = loadText("Taskfile.yml");
	if (!raw) return new Set();

	let parsed: Taskfile;
	try {
		parsed = yaml.load(raw) as Taskfile;
	} catch (error) {
		record(
			"Taskfile.yml",
			`YAML parse failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return new Set();
	}

	const tasks = parsed.tasks ?? {};
	for (const [taskName, definition] of Object.entries(tasks)) {
		const taskDir = definition.dir ?? ".";
		for (const commandDefinition of definition.cmds ?? []) {
			const command =
				typeof commandDefinition === "string"
					? commandDefinition
					: (commandDefinition.cmd ?? "");
			for (const executablePath of localExecutablePaths(command)) {
				const base = executablePath.startsWith(".") ? "." : taskDir;
				const resolved = path.normalize(path.join(base, executablePath));
				if (!exists(resolved)) {
					record(
						`Taskfile.yml:${taskName}`,
						`references missing executable ${resolved}`,
					);
				}
			}
		}
	}

	return new Set(Object.keys(tasks));
}

function auditPackageScripts() {
	const raw = loadText("package.json");
	if (!raw) return;

	let packageJson: { scripts?: Record<string, string> };
	try {
		packageJson = JSON.parse(raw) as { scripts?: Record<string, string> };
	} catch (error) {
		record(
			"package.json",
			`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return;
	}

	for (const [scriptName, command] of Object.entries(
		packageJson.scripts ?? {},
	)) {
		for (const executablePath of localExecutablePaths(command)) {
			if (!exists(executablePath)) {
				record(
					`package.json:${scriptName}`,
					`references missing executable ${executablePath}`,
				);
			}
		}
	}
}

function auditMarkdownLinks(relativePath: string, text: string) {
	const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
	for (const match of text.matchAll(markdownLink)) {
		const target = match[1]?.trim();
		if (!target) continue;
		if (
			target.startsWith("http://") ||
			target.startsWith("https://") ||
			target.startsWith("mailto:") ||
			target.startsWith("#")
		) {
			continue;
		}

		const fileTarget = target.split("#", 1).at(0);
		if (!fileTarget) continue;
		const resolved = path.normalize(
			path.join(path.dirname(relativePath), fileTarget),
		);
		if (!exists(resolved)) {
			record(relativePath, `references missing link target ${resolved}`);
		}
	}
}

function auditDocumentedTasks(
	relativePath: string,
	text: string,
	taskNames: Set<string>,
) {
	const taskReference =
		/(?:^|\n)\s*task\s+([A-Za-z0-9:_-]+)|`task\s+([A-Za-z0-9:_-]+)/gm;
	for (const match of text.matchAll(taskReference)) {
		const taskName = match[1] ?? match[2];
		if (!taskName || taskName.startsWith("-")) continue;
		if (!taskNames.has(taskName)) {
			record(relativePath, `documents missing Taskfile task ${taskName}`);
		}
	}
}

function auditDocumentation(taskNames: Set<string>) {
	for (const relativePath of ["README.md", "docs/README.md", "AGENTS.md"]) {
		const text = loadText(relativePath);
		if (!text) continue;
		auditMarkdownLinks(relativePath, text);
		auditDocumentedTasks(relativePath, text, taskNames);
	}
}

function auditPowerMacroHistory() {
	const relativePath = "data/memory/byosan_money/power_macro_history.json";
	const raw = loadText(relativePath);
	if (!raw) return;

	let history: PowerMacroHistory;
	try {
		history = JSON.parse(raw) as PowerMacroHistory;
	} catch (error) {
		record(
			relativePath,
			`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return;
	}

	if (history.schema_version !== 1) {
		record(relativePath, "schema_version must be 1");
	}
	if (history.domain !== "byosan_money") {
		record(relativePath, "domain must be byosan_money");
	}
	if (!Array.isArray(history.weeks)) {
		record(relativePath, "weeks must be an array");
		return;
	}

	const expectedSeedWeeks = [
		"2026-04-04",
		"2026-04-11",
		"2026-04-18",
		"2026-04-25",
		"2026-05-02",
		"2026-05-09",
		"2026-05-16",
		"2026-05-23",
		"2026-05-30",
		"2026-06-06",
		"2026-06-13",
		"2026-06-20",
		"2026-06-27",
		"2026-07-04",
	];
	const weekEnds = history.weeks.flatMap((week) =>
		week.week_end ? [week.week_end] : [],
	);
	const uniqueWeekEnds = new Set(weekEnds);
	if (uniqueWeekEnds.size !== weekEnds.length) {
		record(relativePath, "week_end values must be unique");
	}
	for (const expected of expectedSeedWeeks) {
		if (!uniqueWeekEnds.has(expected)) {
			record(relativePath, `missing migrated seed week ${expected}`);
		}
	}

	for (const [index, week] of history.weeks.entries()) {
		if (!week.week_end) {
			record(relativePath, `weeks[${index}] is missing week_end`);
		}
		if (
			!week.source_report?.startsWith(
				"https://github.com/KAFKA2306/prompt-vault/blob/",
			)
		) {
			record(relativePath, `weeks[${index}] has invalid source_report provenance`);
		}
	}
}

function main() {
	const taskNames = auditTaskfile();
	auditPackageScripts();
	auditDocumentation(taskNames);
	auditPowerMacroHistory();

	if (failures.length > 0) {
		console.error(`[repo-contract] FAIL (${failures.length})`);
		for (const failure of failures) {
			console.error(`- ${failure.source}: ${failure.message}`);
		}
		process.exit(1);
	}

	console.log(
		`[repo-contract] PASS (${taskNames.size} Taskfile tasks; executable, documentation, and memory references resolved)`,
	);
}

main();
