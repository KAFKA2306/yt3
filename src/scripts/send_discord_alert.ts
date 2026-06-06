import { type AlertType, sendAlert } from "../io/utils/discord.js";

function parseType(value: string | undefined): AlertType {
	switch (value) {
		case "success":
		case "warn":
		case "error":
		case "audit_fail":
		case "publish":
		case "info":
			return value;
		default:
			return "info";
	}
}

async function main() {
	const message = process.env.DISCORD_ALERT_MESSAGE?.trim();
	if (!message) {
		throw new Error("DISCORD_ALERT_MESSAGE is required");
	}

	const type = parseType(process.env.DISCORD_ALERT_TYPE);
	let details: Record<string, unknown> | undefined;
	const detailsJson = process.env.DISCORD_ALERT_DETAILS_JSON?.trim();
	if (detailsJson) {
		try {
			details = JSON.parse(detailsJson) as Record<string, unknown>;
		} catch {
			details = { raw_details: detailsJson };
		}
	}

	await sendAlert(message, type, details);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
