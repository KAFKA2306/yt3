#!/usr/bin/env bash
set -euo pipefail

readonly REPO=/home/kafka/projects/yt3
readonly CLAUDE_BIN=/home/kafka/.local/bin/claude
readonly MODEL="${ENV_REFRESH_MODEL:-haiku}"
readonly BUDGET_USD="${ENV_REFRESH_BUDGET_USD:-1}"
readonly LEDGER="$REPO/logs/environment-refresh.jsonl"
readonly LOCK="$REPO/data/state/environment-refresh.lock"
readonly PROMPT='Read docs/standard/environment-refresh.md and run exactly one refresh cycle as defined there. Follow its guardrails and stop condition.'
readonly ALLOWED=(
  Read Grep Glob Edit Write WebFetch WebSearch
  'Bash(git status:*)' 'Bash(git diff:*)' 'Bash(git log:*)' 'Bash(git rev-parse:*)'
  'Bash(git switch:*)' 'Bash(git checkout:*)' 'Bash(git branch:*)'
  'Bash(git add:*)' 'Bash(git commit:*)' 'Bash(git push -u origin:*)' 'Bash(git push origin:*)'
  'Bash(task env:*)' 'Bash(task lint)' 'Bash(task test)' 'Bash(task check:merge:fast)'
  'Bash(npm:*)' 'Bash(npx:*)' 'Bash(uv:*)' 'Bash(bun:*)'
  'Bash(gh api:*)' 'Bash(gh release:*)' 'Bash(gh search:*)'
  'Bash(curl:*)' 'Bash(systemctl --user:*)' 'Bash(claude plugin:*)' 'Bash(claude mcp:*)'
  'Bash(claude --version)' 'Bash(df:*)' 'Bash(du:*)' 'Bash(ls:*)' 'Bash(cat:*)' 'Bash(command:*)'
)
readonly DENIED=(
  'Bash(sudo:*)' 'Bash(rm -rf:*)' 'Bash(git push --force:*)' 'Bash(git push -f:*)'
  'Bash(git merge:*)' 'Bash(git reset --hard:*)' 'Bash(git clean:*)'
  'Bash(git branch -d:*)' 'Bash(git branch -D:*)' 'Bash(gh pr merge:*)'
  'Bash(task publish:*)' 'Bash(task release:*)' 'Bash(task up:*)' 'Bash(task run:*)' 'Bash(task byosan:*)' 'Bash(task yawa:*)' 'Bash(task humanity:*)'
)

record() {
  local event="$1" detail="$2"
  python3 -I -c '
import json, sys
print(json.dumps({"at": sys.argv[1], "event": sys.argv[2], "detail": sys.argv[3]}, ensure_ascii=False))
' "$(date -Is)" "$event" "$detail" >>"$LEDGER"
}

cd "$REPO"
mkdir -p "$(dirname "$LEDGER")" "$(dirname "$LOCK")"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  printf 'DRY_RUN command:\n%s -p %q --model %s --max-budget-usd %s --permission-mode acceptEdits --no-session-persistence --allowedTools %s --disallowedTools %s\n' \
    "$CLAUDE_BIN" "$PROMPT" "$MODEL" "$BUDGET_USD" "${ALLOWED[*]}" "${DENIED[*]}"
  exit 0
fi

exec 9>"$LOCK"
if ! flock -n 9; then
  record skipped "previous cycle still running"
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  record skipped "working tree dirty; other changes left untouched"
  exit 0
fi

record started "model=$MODEL budget_usd=$BUDGET_USD branch_base=$(git rev-parse --abbrev-ref HEAD)"

set +e
timeout 50m "$CLAUDE_BIN" -p "$PROMPT" \
  --model "$MODEL" \
  --max-budget-usd "$BUDGET_USD" \
  --permission-mode acceptEdits \
  --no-session-persistence \
  --allowedTools "${ALLOWED[@]}" \
  --disallowedTools "${DENIED[@]}"
rc=$?
set -e

record finished "exit_code=$rc head=$(git rev-parse --short HEAD) branch=$(git rev-parse --abbrev-ref HEAD)"
exit "$rc"
