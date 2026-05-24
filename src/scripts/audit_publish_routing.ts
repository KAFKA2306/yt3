import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import {
	YOUTUBE_PROFILES,
	type YouTubeProfileName,
} from "../domain/youtube_profiles.js";

type ExpectedTask = {
	envFile: string;
	profile: string;
};

type ExpectedProfile = {
	bucket: string;
	envFile: string;
	expectedChannelTitle: string;
	expectedChannelHandle: string;
	expectedChannelId: string;
};

const EXPECTED_PROFILES: Record<YouTubeProfileName, ExpectedProfile> = {
	byosan: {
		bucket: "daily_pulse",
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

const EXPECTED_TASKS: Record<string, ExpectedTask> = {
	"publish:byosan": {
		envFile: "config/.env.byosan",
		profile: "byosan",
	},
	"publish:yawa": {
		envFile: "config/.env.yawa",
		profile: "yawa",
	},
	"publish:humanity": {
		envFile: "config/.env",
		profile: "humanity",
	},
};

const EXPECTED_ENV_EXAMPLES: Record<string, YouTubeProfileName> = {
	"config/.env.example": "humanity",
	"config/.env.byosan.example": "byosan",
	"config/.env.yawa.example": "yawa",
};

function flattenCmds(cmds: unknown): string[] {
	if (typeof cmds === "string") return [cmds];
	if (!Array.isArray(cmds)) return [];
	return cmds.flatMap((cmd) =>
		typeof cmd === "string" ? [cmd] : Array.isArray(cmd) ? cmd : [],
	);
}

function assertTaskContains(
	taskName: string,
	cmd: string,
	expected: ExpectedTask,
) {
	if (!cmd.includes(`ENV_FILE=${expected.envFile}`)) {
		throw new Error(
			`Task ${taskName} must pin ENV_FILE=${expected.envFile}, got: ${cmd}`,
		);
	}
	if (!cmd.includes(`YOUTUBE_CHANNEL_PROFILE=${expected.profile}`)) {
		throw new Error(
			`Task ${taskName} must pin YOUTUBE_CHANNEL_PROFILE=${expected.profile}, got: ${cmd}`,
		);
	}
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
		tasks?: Record<string, { cmds?: unknown }>;
	};

	if (!taskfile.tasks) {
		throw new Error("Taskfile.yml does not contain a tasks section");
	}

	for (const [taskName, expected] of Object.entries(EXPECTED_TASKS)) {
		const task = taskfile.tasks[taskName];
		if (!task) {
			throw new Error(`Taskfile.yml is missing task ${taskName}`);
		}

		const cmds = flattenCmds(task.cmds);
		if (cmds.length === 0) {
			throw new Error(`Task ${taskName} does not define any commands`);
		}

		for (const cmd of cmds) {
			assertTaskContains(taskName, cmd, expected);
		}
	}

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
