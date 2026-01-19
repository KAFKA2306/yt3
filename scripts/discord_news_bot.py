# ruff: noqa: I001
import os
import subprocess
from pathlib import Path
from shutil import which
from typing import Any

import discord
from discord import app_commands

import sys  # noqa: I001

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from src.config import load_config  # noqa: E402


def load_environment(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def workflow_command(settings: dict[str, Any], query: str) -> list[str]:
    command = list(settings.get("workflow_command", ["uv", "run", "python", "-m", "src.main"]))
    env_key = settings.get("workflow_command_env", "UV_BIN")
    override = os.getenv(env_key)
    if override:
        command[0] = override
    else:
        resolved = which(command[0])
        if resolved:
            command[0] = resolved
    flag = settings.get("workflow_argument_flag", "--query")
    command.extend([flag, query])
    return command


def render(template: str, query: str) -> str:
    return template.replace("{query}", query)


def register_news_command(tree: app_commands.CommandTree, settings: dict[str, Any], project_root: Path) -> None:
    response_template = settings.get("response_template", "Generating video for: {query}")
    starter_template = settings.get("starter_template", "Starting generation for: {query}")
    thread_prefix = settings.get("thread_prefix", "video-")
    thread_name_limit = int(settings.get("thread_name_limit", 50))
    thread_message = settings.get("thread_message", "Progress will be posted here.")
    command = settings.get("command_name", "news")
    description = settings.get("command_description", "Generate news video")

    @tree.command(name=command, description=description)
    async def handle(interaction: discord.Interaction, query: str) -> None:
        await interaction.response.defer(ephemeral=True)
        starter = await interaction.channel.send(render(starter_template, query))
        thread_name = f"{thread_prefix}{query}"[:thread_name_limit]
        thread = await starter.create_thread(name=thread_name)
        await thread.send(render(thread_message, query))
        subprocess.Popen(workflow_command(settings, query), cwd=str(project_root))
        await interaction.followup.send(render(response_template, query), ephemeral=True)


def create_client(settings: dict[str, Any], project_root: Path) -> discord.Client:
    intents = discord.Intents.default()
    intents.message_content = True

    class Client(discord.Client):
        def __init__(self) -> None:
            super().__init__(intents=intents)
            self.tree = app_commands.CommandTree(self)

        async def setup_hook(self) -> None:
            register_news_command(self.tree, settings, project_root)
            await self.tree.sync()

    return Client()


def main() -> None:
    config = load_config()
    news_settings = config.get("news_bot", {})
    if not news_settings:
        return

    project_root = Path.cwd()
    env_file = news_settings.get("environment_file", "config/.env")
    load_environment(Path(env_file))

    token = os.environ.get(news_settings.get("token_env", "DISCORD_TOKEN"))
    if not token:
        return

    client = create_client(news_settings, project_root)
    client.run(token)


if __name__ == "__main__":
    main()
