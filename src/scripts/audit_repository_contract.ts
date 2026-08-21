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

function main() {
	const taskNames = auditTaskfile();
	auditPackageScripts();
	auditDocumentation(taskNames);

	if (failures.length > 0) {
		console.error(`[repo-contract] FAIL (${failures.length})`);
		for (const failure of failures) {
			console.error(`- ${failure.source}: ${failure.message}`);
		}
		process.exit(1);
	}

	console.log(
		`[repo-contract] PASS (${taskNames.size} Taskfile tasks; executable and documentation references resolved)`,
	);
}

main();
