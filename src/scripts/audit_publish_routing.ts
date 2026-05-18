import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";

type ExpectedTask = {
	envFile: string;
	profile: string;
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

const REQUIRED_ENV_KEYS = [
	"YOUTUBE_EXPECTED_CHANNEL_TITLE",
	"YOUTUBE_EXPECTED_CHANNEL_HANDLE",
	"YOUTUBE_EXPECTED_CHANNEL_ID",
];

function flattenCmds(cmds: unknown): string[] {
	if (typeof cmds === "string") return [cmds];
	if (!Array.isArray(cmds)) return [];
	return cmds.flatMap((cmd) =>
		typeof cmd === "string" ? [cmd] : Array.isArray(cmd) ? cmd : [],
	);
}

function assertTaskContains(taskName: string, cmd: string, expected: ExpectedTask) {
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

function assertEnvExampleContains(envPath: string) {
	const text = fs.readFileSync(envPath, "utf8");
	for (const key of REQUIRED_ENV_KEYS) {
		if (!text.includes(key)) {
			throw new Error(
				`${envPath} is missing required key ${key} for publish routing safety`,
			);
		}
	}
}

async function main() {
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

	for (const envPath of [
		"config/.env.example",
		"config/.env.byosan.example",
		"config/.env.yawa.example",
	]) {
		assertEnvExampleContains(envPath);
	}

	console.log("publish routing audit: PASS");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
