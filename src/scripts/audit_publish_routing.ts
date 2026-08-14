import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import {
	YOUTUBE_PROFILES,
	type YouTubeProfileName,
} from "../domain/youtube_profiles.js";

type ExpectedProfile = {
	bucket: string;
	envFile: string;
	expectedChannelTitle: string;
	expectedChannelHandle: string;
	expectedChannelId: string;
};

type TaskDefinition = {
	cmds?: unknown;
	vars?: Record<string, unknown>;
};

const EXPECTED_PROFILES: Record<YouTubeProfileName, ExpectedProfile> = {
	byosan: {
		bucket: "byosan_money",
		envFile: "config/.env.byosan",
		expectedChannelTitle: "秒算マネー",
		expectedChannelHandle: "@byosan-money",
		expectedChannelId: "UCYtjO-PYBfdG3MuPLXfhA-Q",
	},
	yawa: {
		bucket: "yawa_archive",
		envFile: "config/.env.yawa",
		expectedChannelTitle: "夜話アーカイブ ASMR",
		expectedChannelHandle: "@yawa_archive",
		expectedChannelId: "UCtq3BVv6SBCFjtPiDoetizw",
	},
	humanity: {
		bucket: "humanity_observatory",
		envFile: "config/.env",
		expectedChannelTitle: "雨晴はうの人類観測所",
		expectedChannelHandle: "@humanity_observatory",
		expectedChannelId: "UCMDrWHL4Jc6gtmfoqaW7sxg",
	},
};

const EXPECTED_ALIASES: Record<string, YouTubeProfileName> = {
	"publish:byosan": "byosan",
	"publish:yawa": "yawa",
	"publish:humanity": "humanity",
};

const EXPECTED_ENV_EXAMPLES: Record<string, YouTubeProfileName> = {
	"config/.env.example": "humanity",
	"config/.env.byosan.example": "byosan",
	"config/.env.yawa.example": "yawa",
};

const CANONICAL_PUBLISH_COMMAND =
	"ENV_FILE={{.ENV}} YOUTUBE_CHANNEL_PROFILE={{.PROFILE}} bun src/scripts/publish_youtube.ts {{.CLI_ARGS}}";

function flattenCmds(cmds: unknown): string[] {
	if (typeof cmds === "string") return [cmds];
	if (!Array.isArray(cmds)) return [];
	return cmds.flatMap((cmd) =>
		typeof cmd === "string" ? [cmd] : Array.isArray(cmd) ? cmd : [],
	);
}

function getSingleCommand(taskName: string, task: TaskDefinition): string {
	const commands = flattenCmds(task.cmds);
	if (commands.length !== 1) {
		throw new Error(
			`Task ${taskName} must have exactly one command, got ${commands.length}`,
		);
	}
	return commands[0] ?? "";
}

function assertProfileRegistry() {
	for (const [profileName, expected] of Object.entries(EXPECTED_PROFILES) as [
		YouTubeProfileName,
		ExpectedProfile,
	][]) {
		const profile = YOUTUBE_PROFILES[profileName];
		if (!profile) {
			throw new Error(
				`Missing YouTube profile registry entry for ${profileName}`,
			);
		}

		for (const [field, actual, wanted] of [
			["bucket", profile.bucket, expected.bucket],
			["envFile", profile.envFile, expected.envFile],
			[
				"expectedChannelTitle",
				profile.expectedChannelTitle,
				expected.expectedChannelTitle,
			],
			[
				"expectedChannelHandle",
				profile.expectedChannelHandle,
				expected.expectedChannelHandle,
			],
			[
				"expectedChannelId",
				profile.expectedChannelId,
				expected.expectedChannelId,
			],
		] as const) {
			if (actual !== wanted) {
				throw new Error(
					`YouTube profile registry mismatch for ${profileName}.${field}: expected '${wanted}', got '${actual}'`,
				);
			}
		}
	}
}

function assertCanonicalPublishTask(tasks: Record<string, TaskDefinition>) {
	const task = tasks.publish;
	if (!task) {
		throw new Error("Taskfile.yml is missing canonical task publish");
	}

	const command = getSingleCommand("publish", task);
	if (command !== CANONICAL_PUBLISH_COMMAND) {
		throw new Error(
			`Canonical publish task must call only src/scripts/publish_youtube.ts with explicit profile/env routing, got: ${command}`,
		);
	}

	const envSelector = task.vars?.ENV;
	if (typeof envSelector !== "string") {
		throw new Error("Canonical publish task must define the ENV selector");
	}
	for (const profile of Object.values(EXPECTED_PROFILES)) {
		if (!envSelector.includes(profile.envFile)) {
			throw new Error(
				`Canonical publish ENV selector is missing ${profile.envFile}`,
			);
		}
	}
}

function assertSafeAliases(tasks: Record<string, TaskDefinition>) {
	for (const [taskName, profileName] of Object.entries(EXPECTED_ALIASES)) {
		const task = tasks[taskName];
		if (!task) {
			throw new Error(`Taskfile.yml is missing safe entrypoint ${taskName}`);
		}
		const command = getSingleCommand(taskName, task);
		const expected = `task publish PROFILE=${profileName} -- {{.CLI_ARGS}}`;
		if (command !== expected) {
			throw new Error(
				`Safe entrypoint ${taskName} must delegate only to canonical publish; expected '${expected}', got '${command}'`,
			);
		}
	}
}

function assertEnvExampleContains(
	envPath: string,
	profileName: YouTubeProfileName,
) {
	const text = fs.readFileSync(envPath, "utf8");
	if (!text.includes(`YOUTUBE_CHANNEL_PROFILE=${profileName}`)) {
		throw new Error(
			`${envPath} must pin YOUTUBE_CHANNEL_PROFILE=${profileName} for publish routing safety`,
		);
	}
	if (text.includes("YOUTUBE_EXPECTED_")) {
		throw new Error(
			`${envPath} still contains deprecated YOUTUBE_EXPECTED_* fields`,
		);
	}
}

async function main() {
	assertProfileRegistry();

	const taskfilePath = path.join(process.cwd(), "Taskfile.yml");
	const taskfile = yaml.load(fs.readFileSync(taskfilePath, "utf8")) as {
		tasks?: Record<string, TaskDefinition>;
	};

	if (!taskfile.tasks) {
		throw new Error("Taskfile.yml does not contain a tasks section");
	}

	assertCanonicalPublishTask(taskfile.tasks);
	assertSafeAliases(taskfile.tasks);

	for (const [envPath, profileName] of Object.entries(
		EXPECTED_ENV_EXAMPLES,
	) as [string, YouTubeProfileName][]) {
		assertEnvExampleContains(envPath, profileName);
	}

	console.log("publish routing audit: PASS");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
