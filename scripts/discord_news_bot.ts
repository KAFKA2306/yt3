import "dotenv/config";
import { spawn } from "node:child_process";
import {
	Client,
	GatewayIntentBits,
	REST,
	Routes,
	SlashCommandBuilder,
	type TextChannel,
} from "discord.js";
import { loadConfig } from "../src/core.js";

async function main() {
	const config = loadConfig();
	const settings = config.news_bot || {};
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
	const strTemplate =
		settings.starter_template || "Starting generation for: {query}";
	const resTemplate =
		settings.response_template || "Generating video for: {query}";
	const threadPrefix = settings.thread_prefix || "video-";
	const threadMsg = settings.thread_message || "Progress will be posted here.";

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

	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isChatInputCommand()) return;

		if (interaction.commandName === commandName) {
			const query = interaction.options.getString("query")!;

			await interaction.deferReply({ ephemeral: true });

			const channel = interaction.channel as TextChannel;
			if (!channel) {
				await interaction.editReply("Can only be used in a text channel.");
				return;
			}

			const starterMsg = await channel.send(
				strTemplate.replace("{query}", query),
			);

			const threadName = `${threadPrefix}${query}`.substring(0, 50);
			const thread = await starterMsg.startThread({
				name: threadName,
				autoArchiveDuration: 60,
			});

			await thread.send(threadMsg.replace("{query}", query));

			console.log(`Spawning workflow for: ${query}`);
			const child = spawn("npx", ["tsx", "src/index.ts", query], {
				cwd: process.cwd(),
				stdio: "ignore",
				detached: true,
			});
			child.unref();

			await interaction.editReply(resTemplate.replace("{query}", query));
		}
	});

	client.login(token);
}

main().catch(console.error);
