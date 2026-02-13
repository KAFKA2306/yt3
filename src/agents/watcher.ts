import "dotenv/config";
import { Client, GatewayIntentBits, TextChannel, Colors, EmbedBuilder } from "discord.js";
import { AssetStore, BaseAgent, loadConfig } from "../core.js";
import fs from "fs-extra";
import path from "path";

interface LastRun {
    status?: string;
    duration_seconds?: number;
    exit_code?: number;
}

export class WatcherAgent extends BaseAgent {
    constructor(store: AssetStore) {
        super(store, "watcher");
    }

    async run(serviceResult: string = "unknown") {
        const config = loadConfig();
        const discordConfig = config.discord;
        const token = process.env.DISCORD_TOKEN;
        const channelId = process.env.DISCORD_NOTIFICATION_CHANNEL_ID || discordConfig?.notification_channel_id;

        if (!token || !channelId) return;

        const logDir = path.join(process.cwd(), "logs");
        const lastRunFile = path.join(logDir, "last_run.json");
        let lastRun: LastRun = {};
        if (fs.existsSync(lastRunFile)) {
            lastRun = JSON.parse(fs.readFileSync(lastRunFile, "utf-8"));
        }

        const client = new Client({ intents: [GatewayIntentBits.Guilds] });

        client.once("ready", async () => {
            const channel = await client.channels.fetch(channelId);
            if (!channel || !channel.isTextBased()) throw new Error(`Channel ${channelId} invalid`);

            const isSuccess = serviceResult.includes("success") || (lastRun.status === "success" && serviceResult === "unknown");
            const embed = this.createStatusEmbed(isSuccess, lastRun, serviceResult, logDir);

            await (channel as TextChannel).send({ embeds: [embed] });
            client.destroy();
        });

        await client.login(token);
    }

    private createStatusEmbed(isSuccess: boolean, lastRun: LastRun, serviceResult: string, logDir: string): EmbedBuilder {
        const color = isSuccess ? Colors.Green : Colors.Red;
        const title = isSuccess ? "✅ Success" : "🚨 Failure";
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(color)
            .setTimestamp()
            .addFields(
                { name: "Status", value: lastRun.status || "Unknown", inline: true },
                { name: "Duration", value: `${lastRun.duration_seconds || 0}s`, inline: true },
                { name: "Exit Code", value: `${lastRun.exit_code ?? "N/A"}`, inline: true }
            );

        if (serviceResult !== "unknown") embed.addFields({ name: "Result", value: serviceResult, inline: false });

        if (!isSuccess) {
            const logFile = path.join(logDir, "cron.log");
            if (fs.existsSync(logFile)) {
                const logContent = fs.readFileSync(logFile, "utf-8").trim().split("\n").slice(-5).join("\n");
                embed.addFields({ name: "Logs", value: `\`\`\`\n${logContent}\n\`\`\`` });
            }
        }
        return embed;
    }
}

if (typeof require !== 'undefined' && require.main === module) {
    const ARGS = process.argv.slice(2);
    const serviceResultArg = ARGS.find(a => a.startsWith("--service-result="));
    const serviceResult = serviceResultArg ? serviceResultArg.split("=")[1] : "unknown";
    const store = new AssetStore("watcher");
    new WatcherAgent(store).run(serviceResult);
}
