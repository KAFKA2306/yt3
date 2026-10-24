import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

const LayoutConfig = z.object({
	root: z.object({
		files: z.array(z.string()).min(1),
		directories: z.array(z.string()).min(1),
	}),
	adr: z.object({
		directory: z.string().min(1),
		index: z.string().min(1),
		accepted_status_prefixes: z.array(z.string()).min(1),
	}),
	docs: z.object({
		scanned: z.array(z.string()).min(1),
		excluded_prefixes: z.array(z.string()),
		path_placeholders: z.array(z.string()).min(1),
	}),
});

type LayoutConfig = z.infer<typeof LayoutConfig>;

type AdrFile = { name: string; status: string | undefined };

const ROOT = process.cwd();

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function unlistedRootPaths(
	trackedPaths: string[],
	root: LayoutConfig["root"],
): string[] {
	return trackedPaths.filter((tracked) => {
		const [top = "", ...rest] = tracked.split("/");
		return rest.length === 0
			? !root.files.includes(top)
			: !root.directories.includes(top);
	});
}

export function parseAdrStatus(text: string): string | undefined {
	const lines = text.split("\n");
	const heading = lines.findIndex((line) =>
		/^## (?:Status|ステータス)\b/.test(line),
	);
	if (heading === -1) return undefined;
	return lines
		.slice(heading + 1)
		.map((line) => line.trim())
		.find((line) => line !== "");
}

export function adrIndexViolations(
	adrFiles: AdrFile[],
	indexText: string,
	acceptedPrefixes: string[],
): string[] {
	const names = adrFiles.map((file) => file.name);
	const numbers = adrFiles.map((file) => file.name.slice(0, 4));
	const duplicateNumbers = [
		...new Set(
			numbers.filter((number, index) => numbers.indexOf(number) !== index),
		),
	];
	const indexed = [...indexText.matchAll(/`(\d{4}-[^`\s]+\.md)`/g)].map(
		(match) => match[1] ?? "",
	);
	const accepted = adrFiles.filter(
		(file) =>
			file.status !== undefined &&
			acceptedPrefixes.some((prefix) => file.status?.startsWith(prefix)),
	);

	return [
		...duplicateNumbers.map(
			(number) => `ADR number ${number} is used by more than one file`,
		),
		...accepted
			.filter((file) => !indexed.includes(file.name))
			.map((file) => `accepted ADR ${file.name} is missing from the index`),
		...indexed
			.filter((name) => !names.includes(name))
			.map((name) => `index references missing ADR ${name}`),
	];
}

export function deadPathReferences(
	text: string,
	directories: string[],
	placeholders: string[],
	exists: (relativePath: string) => boolean,
): string[] {
	const alternation = directories.map(escapeRegExp).join("|");
	const pattern = new RegExp(`\`((?:${alternation})/[^\\s\`]+)\``, "g");
	return [...text.matchAll(pattern)]
		.map((match) => match[1] ?? "")
		.filter(
			(reference) => !placeholders.some((item) => reference.includes(item)),
		)
		.filter((reference) => !exists(reference));
}

function isScannedDoc(relativePath: string, config: LayoutConfig): boolean {
	if (!relativePath.endsWith(".md")) return false;
	if (
		config.docs.excluded_prefixes.some((prefix) =>
			relativePath.startsWith(prefix),
		)
	) {
		return false;
	}
	return config.docs.scanned.some((scanned) =>
		scanned.endsWith("/")
			? relativePath.startsWith(scanned)
			: relativePath === scanned,
	);
}

function main() {
	const config = LayoutConfig.parse(
		yaml.load(
			fs.readFileSync(path.join(ROOT, "config/repo_layout.yaml"), "utf-8"),
		),
	);
	const trackedPaths = execFileSync("git", ["ls-files"], { encoding: "utf-8" })
		.split("\n")
		.filter((line) => line !== "");
	const isTracked = (relativePath: string) =>
		trackedPaths.some(
			(tracked) =>
				tracked === relativePath ||
				tracked.startsWith(
					relativePath.endsWith("/") ? relativePath : `${relativePath}/`,
				),
		);
	const isGitignored = (relativePath: string) =>
		spawnSync("git", ["check-ignore", "-q", relativePath], { cwd: ROOT })
			.status === 0;
	const exists = (relativePath: string) =>
		isTracked(relativePath) || isGitignored(relativePath);

	const adrDirectory = config.adr.directory;
	const adrFiles: AdrFile[] = trackedPaths
		.filter(
			(file) =>
				path.posix.dirname(file) === adrDirectory &&
				/^\d{4}-.+\.md$/.test(path.posix.basename(file)),
		)
		.map((file) => ({
			name: path.posix.basename(file),
			status: parseAdrStatus(fs.readFileSync(path.join(ROOT, file), "utf-8")),
		}));
	const adrIndex = fs.readFileSync(path.join(ROOT, config.adr.index), "utf-8");

	const scannedDocs = trackedPaths.filter((file) => isScannedDoc(file, config));
	const docFailures = scannedDocs.flatMap((file) =>
		deadPathReferences(
			fs.readFileSync(path.join(ROOT, file), "utf-8"),
			config.root.directories,
			config.docs.path_placeholders,
			exists,
		).map((reference) => `${file}: references missing path ${reference}`),
	);

	const failures = [
		...unlistedRootPaths(trackedPaths, config.root).map(
			(file) => `${file}: root path is not in config/repo_layout.yaml`,
		),
		...adrIndexViolations(
			adrFiles,
			adrIndex,
			config.adr.accepted_status_prefixes,
		).map((message) => `${config.adr.index}: ${message}`),
		...docFailures,
	];

	if (failures.length > 0) {
		console.error(`[repo-layout] FAIL (${failures.length})`);
		for (const failure of failures) console.error(`- ${failure}`);
		process.exit(1);
	}

	console.log(
		`[repo-layout] PASS (${trackedPaths.length} tracked paths, ${adrFiles.length} ADR files, ${scannedDocs.length} documents scanned)`,
	);
}

if (import.meta.main) main();
