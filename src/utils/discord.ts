import { AgentLogger } from "./logger.js";
export async function sendAlert(
	message: string,
	type: "info" | "success" | "warn" | "error" = "info",
) {
	const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
	if (!webhookUrl) return;
	AgentLogger.info("DISCORD", "ALERT", type.toUpperCase(), message);
	await fetch(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content: `[${type.toUpperCase()}] ${message}` }),
	});
}
