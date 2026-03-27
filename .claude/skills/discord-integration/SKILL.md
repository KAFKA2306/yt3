---
name: discord-integration
description: Manage Discord Webhook alerts and the standalone Discord Slash Command Bot. Use when setting up alerting, debugging bot connectivity, or configuring Discord integrations. Triggers on "Discord", "webhook", "alert", "bot status", "DISCORD_WEBHOOK_URL", or any request to monitor/configure Discord services.
type: skill
---

# Discord Integration Skill

This skill provides instructions for managing Discord communications, including webhook-based alerting and the standalone slash command bot.

## Core Components

### 1. Webhook Alerting
- **Location**: `[src/io/utils/discord.ts](file:///home/kafka/2511youtuber/v3/yt3/src/io/utils/discord.ts)`
- **Function**: `sendAlert(message: string, type: "info" | "success" | "warn" | "error")`
- **Dependency**: Requires `DISCORD_WEBHOOK_URL` in environment.

### 2. Standalone Discord Bot
- **Location**: `[src/agents/standalone/discord_bot.ts](file:///home/kafka/2511youtuber/v3/yt3/src/agents/standalone/discord_bot.ts)`
- **Purpose**: Listens for slash commands (e.g., `/news`) to trigger the video generation workflow.
- **Service Management**: Controlled via systemd services.

## Operational Procedures

### Checking Bot Status
To verify if the Discord bot is running:
```bash
task status
```

### Starting Services
To start the Discord bot and other background services:
```bash
task up
```

### Stopping Services
To stop background services:
```bash
task down
```

### Manual Alert Sending
You can use the `sendAlert` utility in any script to push status updates to the configured Discord channel. Ensure `DISCORD_WEBHOOK_URL` is set in `config/.env`.

## Context Trigger
Use this skill when:
- Monitoring or debugging the Discord bot.
- Implementing new notification hooks.
- Configuring environment variables for Discord integration.
- Managing background services in the production environment.
