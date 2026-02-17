import { spawnSync, spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { AssetStore, BaseAgent, loadConfig, ROOT } from "../core.js";
import { AgentLogger } from "../utils/logger.js";

interface ManagerConfig {
    check_interval_ms: number;
    stale_lock_timeout_seconds: number;
    start_hour: number;
    user: string;
}

export class ManagerAgent extends BaseAgent {
    private mConfig: ManagerConfig;

    constructor(store: AssetStore, opts: Record<string, unknown> = {}) {
        super(store, "manager", opts);
        const mCfg = this.config.providers.manager;
        this.mConfig = {
            check_interval_ms: (opts.check_interval_ms as number) || mCfg.check_interval_ms,
            stale_lock_timeout_seconds: (opts.stale_lock_timeout_seconds as number) || mCfg.stale_lock_timeout_seconds,
            start_hour: mCfg.start_hour,
            user: (opts.user as string) || mCfg.user || "root"
        };
    }

    async run() {
        AgentLogger.info(this.name, "STARTUP", "INIT", "AI Manager Agent starting persistent loop...");

        await this.repairSystem();

        while (true) {
            await this.orchestrationCycle();
            await new Promise(resolve => setTimeout(resolve, this.mConfig.check_interval_ms));
        }
    }

    private async orchestrationCycle() {
        AgentLogger.info(this.name, "ORCHESTRATION", "CHECK", "Starting periodic health and run check");

        await this.checkStaleLocks();
        await this.checkDailyRun();
    }

    private async repairSystem() {
        AgentLogger.info(this.name, "REPAIR", "START", "Running system self-repair checks");
        const lingerCheck = spawnSync("loginctl", ["show-user", this.mConfig.user, "--property=Linger"]);
        if (!lingerCheck.stdout.toString().includes("Linger=yes")) {
            AgentLogger.warn(this.name, "REPAIR", "LINGER_FIX", "Linger disabled. Attempting to enable...");
            spawnSync("loginctl", ["enable-linger", this.mConfig.user]);
            AgentLogger.info(this.name, "REPAIR", "LINGER_FIXED", `Linger enabled for ${this.mConfig.user} user`);
        }
    }

    private async checkStaleLocks() {
        const lockFile = path.join(ROOT, this.config.workflow.paths.lock_file);
        if (fs.existsSync(lockFile)) {
            const stats = fs.statSync(lockFile);
            const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;

            if (ageSeconds > this.mConfig.stale_lock_timeout_seconds) {
                AgentLogger.warn(this.name, "REPAIR", "LOCK_STALE", `Found stale lock file (age: ${Math.round(ageSeconds)}s). Removing...`, {
                    recovery_hint: "Ensuring subsequent runs can acquire the lock."
                });
                fs.removeSync(lockFile);
            }
        }
    }

    private async checkDailyRun() {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const runDir = path.join(ROOT, this.config.workflow.paths.runs_dir, today);

        if (!fs.existsSync(runDir)) {
            const hour = now.getHours();

            if (hour >= this.mConfig.start_hour) {
                AgentLogger.decision(this.name, "ORCHESTRATION", "TRIGGER_RUN", `No run found for today (${today}). Triggering catch-up run.`, {
                    reason: "Missed scheduled daily run"
                });
                this.triggerWorkflow(today);
            }
        }
    }

    private triggerWorkflow(runId: string) {
        AgentLogger.info(this.name, "EXECUTION", "SPAWN", `Spawning workflow for runId: ${runId}`);
        const child = spawn("npx", ["tsx", "src/index.ts"], {
            cwd: ROOT,
            env: { ...process.env, RUN_ID: runId },
            detached: true,
            stdio: "ignore"
        });
        child.unref();
    }
}

if (process.argv[1].endsWith('manager.ts') || process.argv[1].endsWith('manager.js')) {
    const store = new AssetStore("system-manager");
    new ManagerAgent(store).run();
}
