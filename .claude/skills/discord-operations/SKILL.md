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
- Environment Variables: `.env` (contains `DISCORD_TOKEN` and `DISCORD_WEBHOOK_URL`)
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

## System Audits

Execute the following checks when running `task audit` or `AuditAgent`:
1. **systemd Verification**: Run `systemctl --user is-active <unit>` for critical units (`yt3-automation.timer`, `yt3-aim.service`, `yt3-discord.service`, `yt3-asmr-autonomous.timer`).
2. **Connectivity Validation**: Confirm `DISCORD_WEBHOOK_URL` is a valid Discord API webhook URL.
