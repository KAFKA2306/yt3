import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from "discord.js";
import { AssetStore, BaseAgent, loadConfig, RunStage } from "../core.js";
import { AgentState } from "../types.js";

export class WatcherAgent extends BaseAgent {
    private client: Client;
    private channelId: string;

    constructor(store: AssetStore) {
        super(store, RunStage.WATCHER);
        this.channelId = this.config.discord?.notification_channel_id || process.env.DISCORD_NOTIFICATION_CHANNEL_ID || "";
        this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    }

    async run(state: AgentState): Promise<void> {
        this.logInput(state);
        if (!process.env.DISCORD_TOKEN || !this.channelId) {
            this.logOutput({ status: "skipped", reason: "Discord credentials missing" });
            return;
        }

        await this.client.login(process.env.DISCORD_TOKEN);
        const channel = await this.client.channels.fetch(this.channelId) as TextChannel;
        if (!channel) throw new Error(`Could not find Discord channel: ${this.channelId}`);

        const embed = new EmbedBuilder()
            .setTitle(`🚀 Run Completed: ${state.metadata?.title || "Unknown"}`)
            .setColor(0x00AE86)
            .addFields(
                { name: "Run ID", value: state.run_id, inline: true },
                { name: "Status", value: state.status || "succeeded", inline: true },
                { name: "Bucket", value: state.bucket, inline: true },
                { name: "YouTube", value: state.publish_results?.youtube?.status || "Skipped", inline: true },
                { name: "X (Twitter)", value: state.publish_results?.twitter?.status || "Skipped", inline: true }
            )
            .setTimestamp();

        if (state.video_path) embed.addFields({ name: "Video", value: state.video_path });
        if (state.thumbnail_path) embed.setThumbnail(`attachment://${state.thumbnail_path.split("/").pop()}`);

        await channel.send({ embeds: [embed] });
        await this.client.destroy();
        this.logOutput({ status: "notified" });
    }
}
