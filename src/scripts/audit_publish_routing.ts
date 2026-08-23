import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import {
	YOUTUBE_PROFILES,
	type YouTubeProfileName,
} from "../domain/youtube_profiles.js";

type TaskDefinition = { cmds?: unknown };

const PROFILE_TASKS = {
	"release:check": "bun src/scripts/check_product_release.ts",
	publish: "bun src/scripts/publish_youtube.ts",
	auth: "bun src/scripts/youtube_oauth.ts",
} as const;

const PUBLISH_ALIASES: Record<string, YouTubeProfileName> = {
	"publish:byosan": "byosan",
	"publish:yawa": "yawa",
	"publish:humanity": "humanity",
};

function flattenCmds(cmds: unknown): string[] {
	if (typeof cmds === "string") return [cmds];
	if (!Array.isArray(cmds)) return [];
	return cmds.flatMap((cmd) =>
		typeof cmd === "string" ? [cmd] : Array.isArray(cmd) ? cmd : [],
	);
}

function singleCommand(taskName: string, task?: TaskDefinition): string {
	const commands = flattenCmds(task?.cmds);
	if (commands.length !== 1) {
		throw new Error(
			`Task ${taskName} must have exactly one command, got ${commands.length}`,
		);
	}
	return commands[0] ?? "";
}

function assertProfileRegistry() {
	const seen = {
		bucket: new Set<string>(),
		envFile: new Set<string>(),
		tokenPath: new Set<string>(),
		channelId: new Set<string>(),
	};

	for (const [name, profile] of Object.entries(YOUTUBE_PROFILES) as [
		YouTubeProfileName,
		(typeof YOUTUBE_PROFILES)[YouTubeProfileName],
	][]) {
		if (profile.profileName !== name) {
			throw new Error(`Profile key/name mismatch: ${name}/${profile.profileName}`);
		}
		for (const [field, value] of [
			["bucket", profile.bucket],
			["envFile", profile.envFile],
			["tokenPath", profile.tokenPath],
			["expectedChannelTitle", profile.expectedChannelTitle],
			["expectedChannelHandle", profile.expectedChannelHandle],
			["expectedChannelId", profile.expectedChannelId],
		] as const) {
			if (!value.trim()) throw new Error(`Profile ${name}.${field} is empty`);
		}

		for (const [field, value] of [
			["bucket", profile.bucket],
			["envFile", profile.envFile],
			["tokenPath", profile.tokenPath],
			["channelId", profile.expectedChannelId],
		] as const) {
			const values = seen[field];
			if (values.has(value)) {
				throw new Error(`Duplicate YouTube profile ${field}: ${value}`);
			}
			values.add(value);
		}

		const examplePath = `${profile.envFile}.example`;
		if (!fs.existsSync(examplePath)) {
			throw new Error(`Missing profile environment example: ${examplePath}`);
		}
		const example = fs.readFileSync(examplePath, "utf8");
		if (!example.includes(`YOUTUBE_CHANNEL_PROFILE=${name}`)) {
			throw new Error(`${examplePath} must pin YOUTUBE_CHANNEL_PROFILE=${name}`);
		}
	}
}

function assertProfileTasks(tasks: Record<string, TaskDefinition>) {
	for (const [taskName, invocation] of Object.entries(PROFILE_TASKS)) {
		const command = singleCommand(taskName, tasks[taskName]);
		const expected = `YOUTUBE_CHANNEL_PROFILE={{.PROFILE}} ${invocation} {{.CLI_ARGS}}`;
		if (command !== expected) {
			throw new Error(
				`Task ${taskName} must delegate profile resolution to the registry; expected '${expected}', got '${command}'`,
			);
		}
		if (command.includes("ENV_FILE=")) {
			throw new Error(`Task ${taskName} must not resolve environment files`);
		}
	}
}

function assertPublishAliases(tasks: Record<string, TaskDefinition>) {
	for (const [taskName, profile] of Object.entries(PUBLISH_ALIASES)) {
		const command = singleCommand(taskName, tasks[taskName]);
		const expected = `task publish PROFILE=${profile} -- {{.CLI_ARGS}}`;
		if (command !== expected) {
			throw new Error(`Alias ${taskName} must be '${expected}', got '${command}'`);
		}
	}
}

async function main() {
	assertProfileRegistry();
	const taskfile = yaml.load(
		fs.readFileSync(path.join(process.cwd(), "Taskfile.yml"), "utf8"),
	) as { tasks?: Record<string, TaskDefinition> };
	if (!taskfile.tasks) throw new Error("Taskfile.yml has no tasks section");
	assertProfileTasks(taskfile.tasks);
	assertPublishAliases(taskfile.tasks);
	console.log("publish routing audit: PASS");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
