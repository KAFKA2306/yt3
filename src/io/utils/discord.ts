/**
 * Discord Notification Utility
 *
 * Roles:
 * - Webhook: For logs, alerts, success notifications, and system monitoring.
 * - Bot: For external interactions, commands, and interactive operations.
 */
import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../core.js";
import { AgentLogger } from "./logger.js";

export type AlertType =
	| "info"
	| "success"
	| "warn"
	| "error"
	| "audit_fail"
	| "publish";

const COLORS = {
	info: 3447003, // Blue
	success: 3066993, // Green
	warn: 16776960, // Yellow
	error: 15158332, // Red
	audit_fail: 15158332, // Red
	publish: 10181046, // Purple
};

const DISCORD_NOTIFICATION_STATE = path.join(
	ROOT,
	"data",
	"state",
	"discord_notifications.json",
);

const DISCORD_LIMITS = {
	totalPerDay: Number(process.env.DISCORD_MAX_TOTAL_PER_DAY || 20),
	perTypePerDay: Number(process.env.DISCORD_MAX_PER_TYPE_PER_DAY || 6),
	duplicateCooldownMs:
		Number(process.env.DISCORD_DUPLICATE_COOLDOWN_MINUTES || 60) * 60_000,
};

type DiscordNotificationEntry = {
	last_sent_at: string;
	count: number;
	type: AlertType;
	message_hash: string;
};

type DiscordNotificationState = {
	date: string;
	total_sent: number;
	by_type: Partial<Record<AlertType, number>>;
	entries: Record<string, DiscordNotificationEntry>;
};

function todayKey(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

function loadDiscordState(): DiscordNotificationState {
	if (!fs.existsSync(DISCORD_NOTIFICATION_STATE)) {
		return {
			date: todayKey(),
			total_sent: 0,
			by_type: {},
			entries: {},
		};
	}

	try {
		const state = fs.readJsonSync(DISCORD_NOTIFICATION_STATE) as
			| Partial<DiscordNotificationState>
			| undefined;
		if (!state || state.date !== todayKey()) {
			return {
				date: todayKey(),
				total_sent: 0,
				by_type: {},
				entries: {},
			};
		}
		return {
			date: state.date || todayKey(),
			total_sent: state.total_sent || 0,
			by_type: state.by_type || {},
			entries: state.entries || {},
		};
	} catch {
		return {
			date: todayKey(),
			total_sent: 0,
			by_type: {},
			entries: {},
		};
	}
}

function saveDiscordState(state: DiscordNotificationState): void {
	fs.ensureDirSync(path.dirname(DISCORD_NOTIFICATION_STATE));
	fs.writeJsonSync(DISCORD_NOTIFICATION_STATE, state, { spaces: 2 });
}

function normalizeMessage(message: string): string {
	return message.replace(/\s+/g, " ").trim();
}

function buildMessageHash(
	type: AlertType,
	message: string,
	details?: Record<string, unknown>,
): string {
	const payload = JSON.stringify({
		type,
		message: normalizeMessage(message),
		details: details || {},
	});
	return crypto.createHash("sha256").update(payload).digest("hex");
}

function canSendDiscordNotification(
	type: AlertType,
	message: string,
	details?: Record<string, unknown>,
): { allowed: boolean; reason?: string } {
	const state = loadDiscordState();
	const key = buildMessageHash(type, message, details);
	const now = Date.now();
	const entry = state.entries[key];
	const typeCount = state.by_type[type] || 0;

	if (state.total_sent >= DISCORD_LIMITS.totalPerDay) {
		return {
			allowed: false,
			reason: `daily total limit reached (${state.total_sent}/${DISCORD_LIMITS.totalPerDay})`,
		};
	}

	if (typeCount >= DISCORD_LIMITS.perTypePerDay) {
		return {
			allowed: false,
			reason: `type limit reached for ${type} (${typeCount}/${DISCORD_LIMITS.perTypePerDay})`,
		};
	}

	if (entry?.last_sent_at) {
		const lastSent = new Date(entry.last_sent_at).getTime();
		if (
			Number.isFinite(lastSent) &&
			now - lastSent < DISCORD_LIMITS.duplicateCooldownMs
		) {
			return {
				allowed: false,
				reason: `duplicate cooldown active (${Math.round((DISCORD_LIMITS.duplicateCooldownMs - (now - lastSent)) / 1000)}s remaining)`,
			};
		}
	}

	state.total_sent += 1;
	state.by_type[type] = typeCount + 1;
	state.entries[key] = {
		last_sent_at: new Date(now).toISOString(),
		count: (entry?.count || 0) + 1,
		type,
		message_hash: key,
	};
	saveDiscordState(state);
	return { allowed: true };
}

/**
 * Sends a notification via Discord Webhook.
 */
export async function sendAlert(
	message: string,
	type: AlertType = "info",
	details?: Record<string, unknown>,
) {
	const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
	if (!webhookUrl) return;

	const gate = canSendDiscordNotification(type, message, details);
	if (!gate.allowed) {
		AgentLogger.warn(
			"DISCORD",
			"ALERT",
			"RATE_LIMIT",
			`Skipped Discord notification (${type}) due to ${gate.reason}`,
		);
		return;
	}

	AgentLogger.info("DISCORD", "ALERT", type.toUpperCase(), message);

	const embed: {
		title: string;
		description: string;
		color: number;
		timestamp: string;
		footer: { text: string };
		fields?: Array<{ name: string; value: string; inline: boolean }>;
	} = {
		title: `[${type.toUpperCase()}] YT3 System Notification`,
		description: message,
		color: COLORS[type] || COLORS.info,
		timestamp: new Date().toISOString(),
		footer: { text: "YT3 Autonomous Production" },
	};

	if (details) {
		embed.fields = Object.entries(details).map(([key, value]) => ({
			name: key,
			value:
				typeof value === "object"
					? `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
					: String(value),
			inline: true,
		}));
	}

	try {
		await fetch(webhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ embeds: [embed] }),
		});
	} catch (err) {
		const error = err as Error;
		AgentLogger.error(
			"DISCORD",
			"ALERT_FAILED",
			"Failed to send discord alert",
			error.message,
			error,
		);
	}
}

export const discord = {
	info: (msg: string, details?: Record<string, unknown>) =>
		sendAlert(msg, "info", details),
	success: (msg: string, details?: Record<string, unknown>) =>
		sendAlert(msg, "success", details),
	warn: (msg: string, details?: Record<string, unknown>) =>
		sendAlert(msg, "warn", details),
	error: (msg: string, details?: Record<string, unknown>) =>
		sendAlert(msg, "error", details),
};
