#!/usr/bin/env bash
set -euo pipefail

if ! scripts/guard_destructive.sh; then
  echo "CRITICAL: Guard destructive harness rejected execution." >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="runs/destructive_guard/$TS"
mkdir -p "$RUN_DIR"

git clean -fdn > "$RUN_DIR/git_clean_dry_run.txt"

if [ ! -s "$RUN_DIR/git_clean_dry_run.txt" ]; then
  echo "PASS: no files would be removed."
  exit 0
fi

echo "BLOCKED: git clean would remove files. Evidence: $RUN_DIR" >&2
cat "$RUN_DIR/git_clean_dry_run.txt" >&2
exit 1
