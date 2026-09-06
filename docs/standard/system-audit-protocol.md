# System Audit Protocol

Current runtime health checks cover only services installed by the current systemd setup.

## systemd

Check:

- `yt3-automation.timer`
- `yt3-aim.service`
- `yt3-discord.service` when Discord bot credentials are configured

Use:

```bash
systemctl --user is-active <unit>
```

A missing or inactive unit is runtime evidence only. It does not by itself prove a repository defect.

## Discord

When Discord connectivity is in scope, verify the configured credential and the actual service state.

## Authority

`Taskfile.yml`, `src/io/utils/infra/setup_systemd.ts`, and current runtime observation define the active operator and service surface. Obsolete service names or historical automation paths are not runtime authority.
