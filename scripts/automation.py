#!/usr/bin/env python3
# ruff: noqa: I001
from __future__ import annotations

import sys
import argparse
import os
import shlex
import subprocess
from pathlib import Path  # noqa: I001

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from src.config import load_config as load_config_dict  # noqa: E402


def absolute(path: str | None) -> Path:
    if path is None:
        return ROOT
    value = Path(path)
    if value.is_absolute():
        return value
    return ROOT / value


def log_path(base: str, override: str | None, name: str) -> Path:
    if override:
        return absolute(override)
    directory = absolute(base)
    return directory / f"{name}.log"


def merge_env(values: dict[str, str]) -> dict[str, str]:
    data = os.environ.copy()
    for key, value in values.items():
        if value is not None:
            data[key] = value
    return data


def service_command(activate: str | None, cwd: str | None, command: list[str]) -> list[str]:
    parts: list[str] = []
    if activate:
        parts.append(f". {shlex.quote(str(absolute(activate)))}")
    target = shlex.quote(str(absolute(cwd or ".")))
    parts.append(f"cd {target}")
    parts.append(shlex.join(command))
    return ["bash", "-lc", " && ".join(parts)]


def start_services(automation: dict) -> None:
    venv_activate = automation.get("venv_activate")
    log_dir = automation.get("log_dir", "logs/automation")

    for service in automation.get("services", []):
        if not service.get("enabled", True): # Default true if unknown, usually explicit in yaml
            continue

        cwd = service.get("cwd")
        cmd_list = service.get("command", [])
        env_dict = service.get("env", {})
        name = service.get("name", "service")
        log_file = service.get("log_file")
        background = service.get("background", False)

        command = service_command(venv_activate, cwd, cmd_list)
        env = merge_env(env_dict)
        path = log_path(log_dir, log_file, name)
        path.parent.mkdir(parents=True, exist_ok=True)

        with path.open("ab") as stream:
            if background:
                subprocess.Popen(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=stream,
                    stderr=stream,
                    env=env,
                    cwd=ROOT,
                    start_new_session=True,
                )
            else:
                subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=stream,
                    stderr=stream,
                    env=env,
                    cwd=ROOT,
                    check=True,
                )


def schedule_line(automation: dict, schedule: dict) -> str:
    venv_activate = automation.get("venv_activate")
    log_dir = automation.get("log_dir", "logs/automation")

    cwd = schedule.get("cwd")
    env_dict = schedule.get("env", {})
    cmd_list = schedule.get("command", [])
    cron_expr = schedule.get("cron")
    name = schedule.get("name", "job")
    log_file = schedule.get("log_file")

    parts: list[str] = []
    if venv_activate:
        parts.append(f". {shlex.quote(str(absolute(venv_activate)))}")
    parts.append(f"cd {shlex.quote(str(absolute(cwd or '.')))}")

    env_map = {key: value for key, value in env_dict.items() if value is not None}
    
    # Add support for appending extra arguments defined in yaml
    extra_args = schedule.get("args", [])
    cmd_list.extend(extra_args)

    command = shlex.join(cmd_list)
    if env_map:
        exports = " ".join(f"{key}={shlex.quote(str(value))}" for key, value in env_map.items())
        command = f"{exports} {command}"
    parts.append(command)

    path = log_path(log_dir, log_file, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"{cron_expr} {' && '.join(parts)} >> {shlex.quote(str(path))} 2>&1"


def build_schedule(automation: dict) -> list[str]:
    lines: list[str] = []
    for schedule in automation.get("schedules", []):
        if not schedule.get("enabled", True): # Default to true?
            continue
        lines.append(schedule_line(automation, schedule))
    return lines


def apply_cron(lines: list[str]) -> None:
    if not lines:
        return
    content = "\n".join(lines) + "\n"
    subprocess.run(["crontab", "-"], input=content, text=True, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-services", action="store_true")
    parser.add_argument("--skip-cron", action="store_true")
    parser.add_argument("--install-cron", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config_dict()
    automation = config.get("automation", {})

    if not automation.get("enabled", False):
        return

    if not args.skip_services:
        start_services(automation)

    if args.skip_cron:
        return

    lines = build_schedule(automation)
    if args.install_cron:
        apply_cron(lines)
    else:
        for line in lines:
            print(line)


if __name__ == "__main__":
    main()
