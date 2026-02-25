import { type AssetStore, BaseAgent, RunStage } from "../core.js";
import { AgentLogger } from "../utils/logger.js";
export class WatcherAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, RunStage.WATCHER);
	}
	async run() {
		AgentLogger.info(
			this.name,
			"WATCH",
			"START",
			"Starting resource watcher...",
		);
		const channelId = process.env.DISCORD_NOTIFICATION_CHANNEL_ID;
		if (!channelId) {
			AgentLogger.warn(
				this.name,
				"WATCH",
				"CONFIG_MISSING",
				"Discord channel ID missing",
			);
			return;
		}
		AgentLogger.info(
			this.name,
			"WATCH",
			"INIT",
			`Watching for events (Channel: ${channelId})`,
		);
		const token = process.env.DISCORD_TOKEN;
		if (!token) {
			AgentLogger.warn(
				this.name,
				"WATCH",
				"TOKEN_MISSING",
				"Discord token missing",
			);
		}
	}
}
