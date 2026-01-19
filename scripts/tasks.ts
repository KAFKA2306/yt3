
import { spawn, spawnSync, execSync } from "child_process";
import fs from "fs-extra";
import path from "path";

const ARGS = process.argv.slice(2);
const TASKS: Record<string, Function> = {};

function runCmd(cmd: string, args: string[], opts: any = {}) {
    console.log(`> ${cmd} ${args.join(" ")}`);
    return spawnSync(cmd, args, { stdio: "inherit", ...opts });
}

const VV_CONTAINER = "voicevox-nemo";
const VV_IMAGE = "voicevox/voicevox_engine:cpu-ubuntu20.04-latest";
const VV_PORT = "50121";

TASKS["voicevox:start"] = () => {
    // Fail fast if this fails, or use '|| true' in shell if ignoring is desired.
    // Assuming cleaner to just run it. If it fails (e.g. doesn't exist), we might want to ignore.
    // But per instructions: "Delete try-except".
    // We can use ignore stdio to suppress output, but if it throws, it throws.
    // For idempotency, 'docker rm -f' handles non-existence if we don't throw.
    // But execSync throws on non-zero exit.
    // To allow idempotent cleanup without try-catch, we could use spawnSync which returns status.
    spawnSync("docker", ["rm", "-f", VV_CONTAINER], { stdio: 'ignore' });

    runCmd("docker", ["pull", VV_IMAGE], { stdio: 'ignore' });

    const args = [
        "run", "-d",
        "--name", VV_CONTAINER,
        "--restart", "unless-stopped",
        "-p", `${VV_PORT}:50021`,
        VV_IMAGE
    ];
    runCmd("docker", args);
    console.log("Voicevox started. Waiting 5s...");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
};

TASKS["voicevox:stop"] = () => {
    runCmd("docker", ["stop", "-t", "10", VV_CONTAINER]);
};

TASKS["aim:start"] = () => {
    const out = fs.openSync("aim.log", "a");
    const child = spawn("aim", ["up", "--host", "127.0.0.1", "--port", "43800"], {
        detached: true,
        stdio: ['ignore', out, out]
    });
    child.unref();
    console.log("Aim started on port 43800");
};

TASKS["bootstrap"] = () => {
    runCmd("npm", ["install"]);
    TASKS["hf:sync"]();
    TASKS["up"]();
};

TASKS["up"] = () => {
    TASKS["aim:start"]();
    TASKS["voicevox:start"]();

    const out = fs.openSync("discord_bot.log", "a");
    const child = spawn("npx", ["tsx", "scripts/discord_news_bot.ts"], {
        detached: true,
        stdio: ['ignore', out, out]
    });
    child.unref();
    console.log("Discord bot started");
};

TASKS["down"] = () => {
    // Use pkill directly; if it fails (no process), it fails.
    // Or use spawnSync to avoid throwing.
    spawnSync("pkill", ["-f", "aim up"]);
    TASKS["voicevox:stop"]();
    spawnSync("pkill", ["-f", "discord_news_bot"]);
    console.log("Services stopped");
};

TASKS["status"] = () => {
    // Using spawnSync to just output directly without throw if grep fails
    const ps = spawnSync("sh", ["-c", "ps aux | grep -E \"(aim|discord_news_bot)\" | grep -v grep"], { encoding: 'utf-8' });
    if (ps.stdout) console.log(ps.stdout);
    else console.log("No local services running.");

    const docker = spawnSync("sh", ["-c", `docker ps | grep ${VV_CONTAINER}`], { encoding: 'utf-8' });
    if (docker.stdout) console.log(docker.stdout);
    else console.log("Voicevox not running.");
};

TASKS["run"] = () => {
    const idx = ARGS.indexOf("run");
    const forwardedArgs = ARGS.slice(idx + 1);
    runCmd("npx", ["tsx", "src/index.ts", ...forwardedArgs]);
};

TASKS["lint"] = () => {
    runCmd("npx", ["tsc", "--noEmit"]);
};

TASKS["test"] = () => {
    runCmd("npx", ["tsx", "--test", "tests/*.test.ts"]);
};

TASKS["hf:sync"] = () => {
    runCmd("task", ["-d", "external/hf-cache-hub", "hf:sync"], {
        env: {
            ...process.env,
            HF_HOME: path.join(process.env.HOME || "", ".cache/huggingface"),
            HF_HUB_CACHE: path.join(process.env.HOME || "", ".cache/huggingface/hub")
        }
    });
};

TASKS["cron"] = () => {
    runCmd("npx", ["tsx", "scripts/automation.ts", "--install-cron"]);
};

const cmd = ARGS[0];
if (cmd && TASKS[cmd]) {
    TASKS[cmd]();
} else {
    console.log("Available tasks:");
    Object.keys(TASKS).forEach(k => console.log(`  ${k}`));
}
