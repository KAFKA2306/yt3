
import { spawnSync, spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { AssetStore, BaseAgent, loadConfig, ROOT } from "../core.js";
import { AgentLogger } from "../utils/logger.js";

interface ManagerConfig {
    check_interval_ms: number;
    stale_lock_timeout_seconds: number;
}

export class ManagerAgent extends BaseAgent {
    private config: ManagerConfig;

    constructor(store: AssetStore, opts: Record<string, any> = {}) {
        super(store, "manager", opts);
        this.config = {
            check_interval_ms: opts.check_interval_ms || 300000, // 5 minutes
            stale_lock_timeout_seconds: opts.stale_lock_timeout_seconds || 3600 // 1 hour
        };
    }

    async run() {
        AgentLogger.info(this.name, "STARTUP", "INIT", "AI Manager Agent starting persistent loop...");

        // Initial repair cycle
        await this.repairSystem();

        // Loop indefinitely
        while (true) {
            try {
                await this.orchestrationCycle();
            } catch (error) {
                AgentLogger.error(this.name, "CYCLE", "ERROR", "Error in orchestration cycle", error as Error);
            }
            await new Promise(resolve => setTimeout(resolve, this.config.check_interval_ms));
        }
    }

    private async orchestrationCycle() {
        AgentLogger.info(this.name, "ORCHESTRATION", "CHECK", "Starting periodic health and run check");

        await this.checkStaleLocks();
        await this.checkDailyRun();
        // Here we could add trend checks or other dynamic triggers
    }

    private async repairSystem() {
        AgentLogger.info(this.name, "REPAIR", "START", "Running system self-repair checks");

        // Ensure Linger is enabled (Critical for systemd user units)
        try {
            const lingerCheck = spawnSync("loginctl", ["show-user", "root", "--property=Linger"]);
            if (!lingerCheck.stdout.toString().includes("Linger=yes")) {
                AgentLogger.warn(this.name, "REPAIR", "LINGER_FIX", "Linger disabled. Attempting to enable...");
                spawnSync("loginctl", ["enable-linger", "root"]);
                AgentLogger.info(this.name, "REPAIR", "LINGER_FIXED", "Linger enabled for root user");
            }
        } catch (e) {
            AgentLogger.error(this.name, "REPAIR", "LINGER_FAILURE", "Failed to check or fix linger status", e as Error);
        }
    }

    private async checkStaleLocks() {
        const lockFile = path.join(ROOT, "logs", "cron.lock");
        if (fs.existsSync(lockFile)) {
            const stats = fs.statSync(lockFile);
            const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;

            if (ageSeconds > this.config.stale_lock_timeout_seconds) {
                AgentLogger.warn(this.name, "REPAIR", "LOCK_STALE", `Found stale lock file (age: ${Math.round(ageSeconds)}s). Removing...`, {
                    recovery_hint: "Ensuring subsequent runs can acquire the lock."
                });
                fs.removeSync(lockFile);
            }
        }
    }

    private async checkDailyRun() {
        // Use local time for "today" to respect system timezone (JST)
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const runDir = path.join(ROOT, "runs", today);

        if (!fs.existsSync(runDir)) {
            const now = new Date();
            const hour = now.getHours();

            // If it's after 07:00 JST and no run exists for today
            // Note: JST is UTC+9. So local machine time check is sufficient if it's set to JST.
            if (hour >= 7) {
                AgentLogger.decision(this.name, "ORCHESTRATION", "TRIGGER_RUN", `No run found for today (${today}). Triggering catch-up run.`, {
                    reason: "Missed scheduled daily run"
                });
                this.triggerWorkflow(today);
            }
        }
    }

    private triggerWorkflow(runId: string) {
        AgentLogger.info(this.name, "EXECUTION", "SPAWN", `Spawning workflow for runId: ${runId}`);
        // Detached spawn to let the workflow run independently
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
    new ManagerAgent(store).run().catch(err => {
        AgentLogger.error("manager", "CRITICAL", "FATAL", "Manager Agent crashed", err);
        process.exit(1);
    });
}
