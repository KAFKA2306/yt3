import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { getByosanProductionConfig } from "../domain/byosan/production_config.js";

const { dir, repo, ref } =
	getByosanProductionConfig().feature_production.video.openmontage;

function run(command: string, args: string[], cwd?: string): void {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed: ${result.status}`);
	}
}

if (!fs.existsSync(dir)) run("git", ["clone", repo, dir]);
run("git", ["fetch", "origin", ref], dir);
run("git", ["checkout", ref], dir);
run(
	"npm",
	["install", "--no-audit", "--no-fund"],
	path.join(dir, "remotion-composer"),
);
