#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"
IP="$(hostname -I 2>/dev/null | awk 'NF{print $1; exit}')"
if [ -z "$IP" ]; then
  IP="127.0.0.1"
fi
nohup aim up --host 127.0.0.1 --port 43800 >/dev/null 2>&1 &
printf 'Aim dashboard: http://%s:43800\n' "$IP"
