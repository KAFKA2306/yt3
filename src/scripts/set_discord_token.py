#!/usr/bin/env python3
"""Safely update the Discord bot token without putting it in argv or logs."""
from __future__ import annotations

import getpass
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CANONICAL = Path('.env')
LEGACY = (Path('config/.env'), Path('config/.env.byosan'), Path('config/.env.yawa'))
ASSIGNMENT = re.compile(r'^\s*(?:export\s+)?DISCORD_TOKEN\s*=')
TOKEN = re.compile(r'[A-Za-z0-9._-]{20,200}\Z')


def is_token_line(line: str) -> bool:
    return bool(ASSIGNMENT.match(line))


def validate_token(value: str) -> None:
    if not TOKEN.fullmatch(value) or value.lower() in {'your_discord_bot_token_here', 'undefined', 'null'}:
        raise ValueError('Token must be a nonempty Discord bot token; no whitespace or placeholders')


def read_safe(path: Path) -> str | None:
    if path.is_symlink():
        raise ValueError(f'Symlink is not allowed: {path.name}')
    if not path.exists():
        return None
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError(f'Not a regular file: {path.name}')
    return path.read_text(encoding='utf-8')


def updated_text(current: str | None, token: str | None) -> str:
    lines = [line for line in (current or '').splitlines(keepends=True) if not is_token_line(line)]
    text = ''.join(lines)
    if token is not None:
        if text and not text.endswith(('\n', '\r')):
            text += '\n'
        text += f'DISCORD_TOKEN={token}\n'
    return text


def write_private(path: Path, content: str, prefix: str) -> Path:
    fd, filename = tempfile.mkstemp(prefix=prefix, dir=path.parent)
    staged = Path(filename)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(staged, 0o600)
        return staged
    except BaseException:
        staged.unlink(missing_ok=True)
        raise


def apply_token(root: Path, value: str) -> list[Path]:
    validate_token(value)
    changes: dict[Path, tuple[str | None, str]] = {}
    for relative in (CANONICAL, *LEGACY):
        path = root / relative
        old = read_safe(path)
        if old is None and relative != CANONICAL:
            continue
        new = updated_text(old, value if relative == CANONICAL else None)
        if old != new or (old is not None and stat.S_IMODE(path.stat().st_mode) != 0o600):
            changes[path] = (old, new)
    backups: dict[Path, Path] = {}
    staged: dict[Path, Path] = {}
    written: list[Path] = []
    try:
        for path, (old, new) in changes.items():
            if old is not None:
                backups[path] = write_private(path, old, f'{path.name}.backup-')
            staged[path] = write_private(path, new, f'{path.name}.tmp-')
        for path, temporary in staged.items():
            os.replace(temporary, path)
            written.append(path)
    except BaseException:
        for path in reversed(written):
            old, _ = changes[path]
            if old is None:
                path.unlink(missing_ok=True)
            elif path in backups:
                restored = write_private(path, old, f'{path.name}.restore-')
                os.replace(restored, path)
        raise
    finally:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)
    return list(changes)


def check(root: Path) -> None:
    canonical = root / CANONICAL
    data = read_safe(canonical)
    lines = [line for line in (data or '').splitlines() if is_token_line(line)]
    if len(lines) != 1:
        raise ValueError('Canonical .env must contain exactly one DISCORD_TOKEN')
    validate_token(lines[0].split('=', 1)[1].strip())
    if stat.S_IMODE(canonical.stat().st_mode) != 0o600:
        raise ValueError('Canonical .env must have mode 0600')
    for relative in LEGACY:
        data = read_safe(root / relative)
        if data is not None and any(is_token_line(line) for line in data.splitlines()):
            raise ValueError(f'Duplicate DISCORD_TOKEN in {relative}')


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == '--check':
        check(ROOT)
        print('PASS: one private canonical Discord token, no legacy duplicates')
        return 0
    if len(sys.argv) != 1 or not sys.stdin.isatty():
        print('Use an interactive terminal; token arguments and pipes are not accepted', file=sys.stderr)
        return 2
    token = getpass.getpass('New Discord bot token (hidden): ')
    apply_token(ROOT, token)
    check(ROOT)
    print('Updated root .env with mode 0600; removed legacy copies; private backups retained')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        raise SystemExit(1) from None
