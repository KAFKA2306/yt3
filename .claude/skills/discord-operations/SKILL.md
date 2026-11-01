---
name: discord-operations
description: Skill for managing and auditing Discord integrations, webhook notifications, and bot interactions. Handles system notifications (success, warnings, crashes), systemd service status auditing, and slash command progress updates.
type: skill
---

# Discord Operations

## Objective

Ensure reliable and consistent communication between the YT3 autonomous production system and Discord channels/users. Manage webhook logs, slash command interactions, and active systemd daemon health auditing.

## Essential Paths

- Configuration: `/home/kafka/2511youtuber/v3/yt3/config/default.yaml` (under `news_bot` and `discord`)
- Environment Variables: root `.env` is the single runtime source for `DISCORD_TOKEN` (loaded by `dotenv/config`); profile files must not duplicate it. `DISCORD_WEBHOOK_URL` remains separate.
- Utility Script: `/home/kafka/2511youtuber/v3/yt3/src/io/utils/discord.ts`
- Standalone Bot: `/home/kafka/2511youtuber/v3/yt3/src/agents/standalone/discord_bot.ts`

## Key Functions

### 1. Alert Notifications (`sendAlert`)
Use `sendAlert(message, type, details)` for real-time channel notifications:
- **info**: General operational milestones.
- **success**: Video rendering, pipeline completion, and test passes.
- **warn**: Partial failures, retry warnings, or non-critical state desyncs.
- **error**: Fatal program crashes or API quota failures.
- **audit_fail**: Blocked video uploads due to quality gate audit failures.
- **publish**: Successful publication to YouTube or Twitter (X). **MUST** include clickable video URLs.

### 2. Standalone News Bot
The bot runs at `src/agents/standalone/discord_bot.ts` under service unit `yt3-discord.service`:
- Registers `/news <query>` slash command to trigger video generation.
- Automatically spins progress threads prefixed with `video-` to post workflow updates.

## Safe Discord token replacement

From the repository root, run `python3 src/scripts/set_discord_token.py` in an interactive terminal. The token is entered with hidden input, never passed on the command line or printed. The tool rejects blank/placeholder tokens and symlink targets, backs up any changed environment files as private mode 0600 copies, writes root `.env` atomically, and removes duplicate `DISCORD_TOKEN` assignments from `config/.env`, `config/.env.byosan`, and `config/.env.yawa` without changing their other keys. Backups are ignored by Git. Verify with `python3 src/scripts/set_discord_token.py --check`, then restart `yt3-discord.service` and verify the bot can authenticate. Do not use `sed` or commit tokens to Git. A successful local update does not prove Discord authentication until the service is tested.

## System Audits

Execute the following checks when running `task audit` or `AuditAgent`:
1. **systemd Verification**: Run `systemctl --user is-active <unit>` for current critical units (`yt3-automation.timer`, `yt3-aim.service`, `yt3-discord.service`). Do not include the retired `yt3-asmr-autonomous.timer`; its referenced script was removed and its user unit was disabled.
2. **Connectivity Validation**: Confirm `DISCORD_WEBHOOK_URL` is a valid Discord API webhook URL.
