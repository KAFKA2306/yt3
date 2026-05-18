/**
 * Discord Notification Utility
 *
 * Roles:
 * - Webhook: For logs, alerts, success notifications, and system monitoring.
 * - Bot: For external interactions, commands, and interactive operations.
 */
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
