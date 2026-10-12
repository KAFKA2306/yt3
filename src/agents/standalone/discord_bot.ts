import "dotenv/config";
import { spawn } from "node:child_process";
import {
	type ChatInputCommandInteraction,
	Client,
	Events,
	GatewayIntentBits,
	REST,
	Routes,
	SlashCommandBuilder,
	type TextChannel,
} from "discord.js";
import { validateQuerySafe } from "../../domain/validation.js";
import { loadConfig } from "../../io/core.js";
import {
	discordFailureExitCode,
	isPermanentDiscordError,
	sendAlert,
} from "../../io/utils/discord.js";
import { AgentLogger } from "../../io/utils/logger.js";

type NewsCommandMessages = {
	starter: string;
	response: string;
	threadPrefix: string;
	threadMessage: string;
};

const INVALID_QUERY_REPLY =
	"Invalid query. Please use only letters, numbers, and basic punctuation.";
const EXECUTION_FAILED_REPLY =
	"Failed to start news generation. Check the bot log.";

export async function handleNewsCommand(
	interaction: ChatInputCommandInteraction,
	messages: NewsCommandMessages,
	launchWorkflow: (query: string) => Promise<void>,
): Promise<void> {
	const rawQuery = interaction.options.getString("query") || "";

	try {
		await interaction.deferReply({ ephemeral: true });

		const validation = validateQuerySafe(rawQuery);
		if (!validation.success || validation.data === undefined) {
			await interaction.editReply(INVALID_QUERY_REPLY);
			return;
		}
		const query = validation.data;

		const channel = interaction.channel as TextChannel | null;
		if (!channel) {
			await interaction.editReply("Can only be used in a text channel.");
			return;
		}

		const starterMsg = await channel.send(
			messages.starter.replace("{query}", query),
		);

		const threadName = `${messages.threadPrefix}${query}`.substring(0, 50);
		const thread = await starterMsg.startThread({
			name: threadName,
			autoArchiveDuration: 60,
		});

		await thread.send(messages.threadMessage.replace("{query}", query));

		console.log(`Spawning workflow for: ${query}`);
		await launchWorkflow(query);

		await interaction.editReply(messages.response.replace("{query}", query));
	} catch (error) {
		AgentLogger.error(
			"DISCORD",
			"NEWS_COMMAND",
			"FAILED",
			"News command failed",
			error as Error,
		);
		await interaction.editReply(EXECUTION_FAILED_REPLY);
	}
}

function launchWorkflow(query: string): Promise<void> {
	const child = spawn("npx", ["tsx", "src/index.ts", query], {
		cwd: process.cwd(),
		stdio: "ignore",
		detached: true,
	});
	child.on("error", (error) =>
		AgentLogger.error(
			"DISCORD",
			"WORKFLOW",
			"SPAWN_ERROR",
			`Workflow process error for: ${query}`,
			error,
		),
	);
	return new Promise((resolve, reject) => {
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
		child.once("error", reject);
	});
}

async function exitOnFailure(error: unknown): Promise<never> {
	const err = error as Error;
	AgentLogger.error("DISCORD", "BOT", "FATAL", "Discord bot stopped", err);
	if (isPermanentDiscordError(error)) {
		await sendAlert(
			`Discord bot stopped on a permanent error: ${err.message}. Systemd will not restart it until the token or intents are fixed.`,
			"error",
		);
	}
	process.exit(discordFailureExitCode(error));
}

async function main() {
	const config = loadConfig();
	const settings = config.news_bot;
	if (!settings) {
		console.log("No news_bot settings found.");
		return;
	}

	const token = process.env.DISCORD_TOKEN || process.env[settings.token_env];
	if (!token) {
		console.error("No DISCORD_TOKEN found in env.");
		return;
	}

	const client = new Client({ intents: [GatewayIntentBits.Guilds] });

	const commandName = settings.command_name || "news";
	const description = settings.command_description || "Generate news video";
	const messages: NewsCommandMessages = {
		starter: settings.starter_template || "Starting generation for: {query}",
		response: settings.response_template || "Generating video for: {query}",
		threadPrefix: settings.thread_prefix || "video-",
		threadMessage: settings.thread_message || "Progress will be posted here.",
	};

	const commands = [
		new SlashCommandBuilder()
			.setName(commandName.toLowerCase())
			.setDescription(description)
			.addStringOption((option) =>
				option
					.setName("query")
					.setDescription("Topic to generate news about")
					.setRequired(true),
			),
	];

	const rest = new REST({ version: "10" }).setToken(token);

	client.once("ready", async () => {
		console.log(`Logged in as ${client.user?.tag}!`);
		console.log("Refreshing application (/) commands.");
		if (client.user) {
			await rest.put(Routes.applicationCommands(client.user.id), {
				body: commands,
			});
		}
	});

	client.on(Events.ShardError, (error) => {
		if (isPermanentDiscordError(error)) exitOnFailure(error);
	});

	client.on("interactionCreate", (interaction) => {
		if (!interaction.isChatInputCommand()) return;
		if (interaction.commandName !== commandName) return;
		handleNewsCommand(interaction, messages, launchWorkflow).catch((error) =>
			AgentLogger.error(
				"DISCORD",
				"NEWS_COMMAND",
				"UNHANDLED",
				"News command handler failed",
				error as Error,
			),
		);
	});

	try {
		await client.login(token);
	} catch (error) {
		await exitOnFailure(error);
	}
}

if (import.meta.main) {
	main().catch(exitOnFailure);
}
