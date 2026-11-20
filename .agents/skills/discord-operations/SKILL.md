---
name: discord-operations
description: Manage and audit YT3 Discord integrations, webhook notifications, standalone bot service, and safe DISCORD_TOKEN rotation.
---

# Discord Operations

## Essential Paths

- Environment Variables: root `.env` is the single runtime source for `DISCORD_TOKEN` (loaded by `dotenv/config`); profile files must not duplicate it. `DISCORD_WEBHOOK_URL` remains separate.
- Utility Script: `src/io/utils/discord.ts`
- Standalone Bot: `src/agents/standalone/discord_bot.ts` (user service `yt3-discord.service`)
- Token Tool: `src/scripts/set_discord_token.py`

## Safe Discord token replacement

From the repository root, run `python3 src/scripts/set_discord_token.py` in an interactive terminal. The token is entered with hidden input, never passed on the command line or printed. The tool rejects blank/placeholder tokens and symlink targets, backs up any changed environment files as private mode 0600 copies, writes root `.env` atomically, and removes duplicate `DISCORD_TOKEN` assignments from `config/.env`, `config/.env.byosan`, and `config/.env.yawa` without changing their other keys. Backups are ignored by Git. Verify with `python3 src/scripts/set_discord_token.py --check`, then restart `yt3-discord.service` and verify the bot can authenticate. Do not use `sed` or commit tokens to Git. A successful local update does not prove Discord authentication until the service is tested.

## Service checks

- Check active user units as `kafka` (never root/sudo): `systemctl --user is-active yt3-discord.service`
- Inspect recent logs: `journalctl --user -u yt3-discord.service -n 50 --no-pager`
- Notification rate limits and cooldown state are managed in `src/io/utils/discord.ts` (`DISCORD_MAX_TOTAL_PER_DAY`, `DISCORD_MAX_PER_TYPE_PER_DAY`, `DISCORD_DUPLICATE_COOLDOWN_MINUTES`).
