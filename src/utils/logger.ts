import fs from "fs-extra";
import path from "path";

const ROOT = process.cwd();

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export interface AgentLogEntry {
    timestamp: string;
    level: LogLevel;
    agent: string;
    stage: string;
    event: string;
    message: string;
    rational?: string;
    context?: Record<string, unknown>;
    recovery_hint?: string;
    error?: {
        message: string;
        stack?: string;
        code?: string | number;
    };
}

export class AgentLogger {
    private static logFile = path.join(ROOT, "logs", "agent_activity.jsonl");

    static init() {
        fs.ensureDirSync(path.join(ROOT, "logs"));
    }

    private static log(entry: AgentLogEntry) {
        this.init();
        const line = JSON.stringify(entry) + "\n";
        fs.appendFileSync(this.logFile, line);

        // Console output for human observability in a structured way
        const consoleMsg = `[${entry.timestamp}] [${entry.level}] [${entry.agent}:${entry.stage}] ${entry.event}: ${entry.message}`;
        if (entry.level === "ERROR") {
            console.error(consoleMsg);
        } else if (entry.level === "WARN") {
            console.warn(consoleMsg);
        } else {
            console.log(consoleMsg);
        }
    }

    static info(agent: string, stage: string, event: string, message: string, extra: Partial<AgentLogEntry> = {}) {
        this.log({
            timestamp: new Date().toISOString(),
            level: "INFO",
            agent,
            stage,
            event,
            message,
            ...extra
        });
    }

    static warn(agent: string, stage: string, event: string, message: string, extra: Partial<AgentLogEntry> = {}) {
        this.log({
            timestamp: new Date().toISOString(),
            level: "WARN",
            agent,
            stage,
            event,
            message,
            ...extra
        });
    }

    static error(agent: string, stage: string, event: string, message: string, error?: Error, extra: Partial<AgentLogEntry> = {}) {
        this.log({
            timestamp: new Date().toISOString(),
            level: "ERROR",
            agent,
            stage,
            event,
            message,
            error: error ? {
                message: error.message,
                stack: error.stack,
                code: (error as any).code
            } : undefined,
            ...extra
        });
    }

    static decision(agent: string, stage: string, decision: string, rational: string, context?: Record<string, unknown>) {
        this.info(agent, stage, "DECISION", decision, { rational, context });
    }

    static transition(agent: string, from: string, to: string, intent: string) {
        this.info(agent, "SYSTEM", "TRANSITION", `Moving from ${from} to ${to}`, { context: { from, to, intent } });
    }

    static heartbeat(agent: string, context?: Record<string, unknown>) {
        this.log({
            timestamp: new Date().toISOString(),
            level: "DEBUG",
            agent,
            stage: "HEARTBEAT",
            event: "ALIVE",
            message: "Agent is active and healthy",
            context
        });
    }
}
