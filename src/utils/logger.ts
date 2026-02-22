import path from "node:path";
import fs from "fs-extra";
import { ROOT, loadConfig } from "../core.js";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export interface AgentLogEntry {
  timestamp: string;
  level: LogLevel;
  agent: string;
  stage: string;
  event: string;
  message: string;
  rational?: string | undefined;
  context?: Record<string, unknown> | undefined;
  recovery_hint?: string | undefined;
  error?:
    | {
        message: string;
        stack?: string | undefined;
        code?: string | number | undefined;
      }
    | undefined;
}

let logFile: string;

function init() {
  const cfg = loadConfig();
  logFile = path.isAbsolute(cfg.logging.activity_log_file)
    ? cfg.logging.activity_log_file
    : path.join(ROOT, cfg.logging.activity_log_file);
  fs.ensureDirSync(path.dirname(logFile));
}

function log(entry: AgentLogEntry) {
  if (!logFile) init();
  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(logFile, line);

  const consoleMsg = `[${entry.timestamp}] [${entry.level}] [${entry.agent}:${entry.stage}] ${entry.event}: ${entry.message}`;
  if (entry.level === "ERROR") {
    console.error(consoleMsg);
  } else if (entry.level === "WARN") {
    console.warn(consoleMsg);
  } else {
    console.log(consoleMsg);
  }
}

export const AgentLogger = {
  init,
  info(
    agent: string,
    stage: string,
    event: string,
    message: string,
    extra: Partial<AgentLogEntry> = {},
  ) {
    log({
      timestamp: new Date().toISOString(),
      level: "INFO",
      agent,
      stage,
      event,
      message,
      ...extra,
    });
  },

  warn(
    agent: string,
    stage: string,
    event: string,
    message: string,
    extra: Partial<AgentLogEntry> = {},
  ) {
    log({
      timestamp: new Date().toISOString(),
      level: "WARN",
      agent,
      stage,
      event,
      message,
      ...extra,
    });
  },

  error(
    agent: string,
    stage: string,
    event: string,
    message: string,
    error?: Error,
    extra: Partial<AgentLogEntry> = {},
  ) {
    log({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      agent,
      stage,
      event,
      message,
      error: error
        ? {
            message: error.message,
            stack: error.stack,
            code: (error as { code?: string | number }).code,
          }
        : undefined,
      ...extra,
    });
  },

  decision(
    agent: string,
    stage: string,
    decision: string,
    rational: string,
    context?: Record<string, unknown>,
  ) {
    AgentLogger.info(agent, stage, "DECISION", decision, { rational, context });
  },

  transition(agent: string, from: string, to: string, intent: string) {
    AgentLogger.info(agent, "SYSTEM", "TRANSITION", `Moving from ${from} to ${to}`, {
      context: { from, to, intent },
    });
  },

  heartbeat(agent: string, context?: Record<string, unknown> | undefined) {
    log({
      timestamp: new Date().toISOString(),
      level: "DEBUG",
      agent,
      stage: "HEARTBEAT",
      event: "ALIVE",
      message: "Agent is active and healthy",
      context,
    });
  },
};
