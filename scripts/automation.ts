
import "dotenv/config";
import fs from "fs-extra";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { loadConfig } from "../src/config.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function logPath(base: string, override: string | undefined, name: string): string {
    const dir = override ? path.resolve(override) : path.resolve(base);
    return path.join(dir, `${name}.log`);
}

async function startServices(automation: any) {
    const logDir = automation.log_dir || "logs/automation";

    for (const service of (automation.services || [])) {
        if (service.enabled === false) continue;

        const cmdList = service.command || [];
        if (cmdList.length === 0) continue;

        const cwd = service.cwd ? path.resolve(service.cwd) : ROOT;
        const env = { ...process.env, ...(service.env || {}) };
        const name = service.name || "service";
        const logFile = service.log_file;
        const background = service.background || false;

        const lp = logPath(logDir, logFile, name);
        fs.ensureDirSync(path.dirname(lp));

        const out = fs.openSync(lp, "a");
        const err = fs.openSync(lp, "a");

        console.log(`Starting service: ${name}`);

        if (background) {
            const child = spawn(cmdList[0], cmdList.slice(1), {
                cwd,
                env,
                stdio: ['ignore', out, err],
                detached: true
            });
            child.unref();
        } else {
            spawnSync(cmdList[0], cmdList.slice(1), {
                cwd,
                env,
                stdio: ['ignore', out, err]
            });
        }
    }
}

function buildSchedule(automation: any): string[] {
    const lines: string[] = [];
    const logDir = automation.log_dir || "logs/automation";

    for (const schedule of (automation.schedules || [])) {
        if (schedule.enabled === false) continue;

        const cwd = schedule.cwd ? path.resolve(schedule.cwd) : ROOT;
        const cmdList = schedule.command || [];
        const cronExpr = schedule.cron;
        const name = schedule.name || "job";
        const logFile = schedule.log_file;
        const envDict = schedule.env || {};
        const extraArgs = schedule.args || [];

        const fullCmd = [...cmdList, ...extraArgs];

        const lp = logPath(logDir, logFile, name);
        fs.ensureDirSync(path.dirname(lp));

        const envExports = Object.entries(envDict)
            .map(([k, v]) => `${k}='${v}'`)
            .join(' ');

        const cmdStr = fullCmd.join(' ');

        const entry = `${cronExpr} cd ${cwd} && ${envExports ? envExports + ' ' : ''}${cmdStr} >> ${lp} 2>&1`;
        lines.push(entry);
    }
    return lines;
}

function applyCron(lines: string[]) {
    if (lines.length === 0) return;
    const content = lines.join("\n") + "\n";
    console.log("Applying cron:");
    console.log(content);

    spawnSync("crontab", ["-"], {
        input: content,
        encoding: 'utf-8'
    });
}

async function main() {
    const args = process.argv.slice(2);
    const config = loadConfig();
    const automation = config.automation || {};

    if (automation.enabled === false) return;

    if (!args.includes("--skip-services")) {
        await startServices(automation);
    }

    if (args.includes("--skip-cron")) return;

    const lines = buildSchedule(automation);
    if (args.includes("--install-cron")) {
        applyCron(lines);
    } else {
        lines.forEach(l => console.log(l));
    }
}

main().catch(console.error);
