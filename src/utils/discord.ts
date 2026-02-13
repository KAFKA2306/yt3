import { WebhookClient, EmbedBuilder } from "discord.js";
import { loadConfig } from "../core.js";

const config = loadConfig();

export async function sendAlert(message: string, level: "info" | "error" | "success" = "info") {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.log(`[Alert] ${level.toUpperCase()}: ${message}`);
        return;
    }

    const webhookClient = new WebhookClient({ url: webhookUrl });
    const colors = { info: 0x0099FF, error: 0xFF0000, success: 0x00FF00 };
    const embed = new EmbedBuilder()
        .setTitle(`Alert: ${level.toUpperCase()}`)
        .setDescription(message.substring(0, 4000))
        .setColor(colors[level])
        .setTimestamp();

    await webhookClient.send({
        username: "YouTube Bot",
        embeds: [embed],
    });
}
