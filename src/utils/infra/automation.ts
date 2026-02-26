import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { loadConfig } from "../../core.js";

const ROOT = process.cwd();

function logPath(
	base: string,
	override: string | undefined,
	name: string,
): string {
	const dir = override ? path.resolve(override) : path.resolve(base);
	return path.join(dir, `${name}.log`);
}

async function startServices(automation: any) {
	const logDir = automation.log_dir || "logs/automation";
	for (const service of automation.services || []) {
		if (service.enabled === false) continue;
		const cmdList = service.command || [];
		if (cmdList.length === 0) continue;
		const cwd = service.cwd ? path.resolve(service.cwd) : ROOT;
		const lp = logPath(logDir, service.log_file, service.name || "service");
		fs.ensureDirSync(path.dirname(lp));
		const out = fs.openSync(lp, "a");

		if (service.background !== false) {
			const child = spawn(cmdList[0], cmdList.slice(1), {
				cwd,
				env: { ...process.env, ...(service.env || {}) },
				stdio: ["ignore", out, out],
				detached: true,
			});
			child.unref();
		} else {
			spawnSync(cmdList[0], cmdList.slice(1), {
				cwd,
				env: { ...process.env, ...(service.env || {}) },
				stdio: ["ignore", out, out],
			});
		}
	}
}

function buildSchedule(automation: any): string[] {
	const lines: string[] = [];
	const logDir = automation.log_dir || "logs/automation";
	for (const schedule of automation.schedules || []) {
		if (schedule.enabled === false) continue;
		const cwd = schedule.cwd ? path.resolve(schedule.cwd) : ROOT;
		const lp = logPath(logDir, schedule.log_file, schedule.name || "job");
		fs.ensureDirSync(path.dirname(lp));
		const envExports = Object.entries(schedule.env || {})
			.map(([k, v]) => `${k}='${v}'`)
			.join(" ");
		lines.push(
			`${schedule.cron} cd ${cwd} && ${envExports ? `${envExports} ` : ""}${[...(schedule.command || []), ...(schedule.args || [])].join(" ")} >> ${lp} 2>&1`,
		);
	}
	return lines;
}

async function main() {
	const args = process.argv.slice(2);
	const config = loadConfig();
	const automation = config.automation || {};
	if (automation.enabled === false) return;

	if (!args.includes("--skip-services")) await startServices(automation);
	if (args.includes("--skip-cron")) return;

	const lines = buildSchedule(automation);
	if (args.includes("--install-cron")) {
		spawnSync("crontab", ["-"], {
			input: `${lines.join("\n")}\n`,
			encoding: "utf-8",
		});
	} else {
		for (const l of lines) {
			console.log(l);
		}
	}
}

main().catch(console.error);
