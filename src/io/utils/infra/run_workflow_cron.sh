#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_dir="$(cd "${script_dir}/../../../../" && pwd)"

# Ensure correct runtime paths
export VIRTUAL_ENV="${repo_dir}/.venv"
export PATH="${VIRTUAL_ENV}/bin:/root/.local/bin:/home/kafka/.bun/bin:/usr/local/bin:$PATH"
readonly bun_bin=$(which bun || echo "/home/kafka/.bun/bin/bun")

readonly ENV_FILE="${ENV_FILE:-config/.env.byosan}"
readonly resolved_env="${repo_dir}/${ENV_FILE}"

# Load environment variables for Discord notifications from bash
if [ -f "${resolved_env}" ]; then
  # Sourcing safely: ignoring comments and empty lines
  export $(grep -v '^#' "${resolved_env}" | xargs)
fi
readonly log_dir="${repo_dir}/data/state"
readonly daily_log_dir="${repo_dir}/logs/daily"
readonly today_date=$(date '+%Y-%m-%d')
readonly log_file="${daily_log_dir}/${today_date}.log"
readonly latest_log="${repo_dir}/logs/latest.log"
readonly status_file="${repo_dir}/data/state/last_run.json"
readonly lock_file="${repo_dir}/logs/cron.lock"
readonly node_bin="${NODE_BIN:-$(if [ -x /root/.nvm/versions/node/v22.17.1/bin/node ]; then echo /root/.nvm/versions/node/v22.17.1/bin/node; else command -v node; fi)}"
readonly log_start_line="$(wc -l < "${log_file}" 2>/dev/null || echo 0)"

mkdir -p "${log_dir}" "${daily_log_dir}"
exec >>"${log_file}" 2>&1

# Symlink latest for easy access
ln -sf "${log_file}" "${latest_log}"

timestamp() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

current_run_log() {
  tail -n +"$((log_start_line + 1))" "${log_file}" 2>/dev/null || true
}

run_auto_heal() {
  local reason="$1"

  if [ "${ENABLE_AUTO_HEAL:-false}" != "true" ]; then
    printf '[%s] WARN  auto-heal skipped for %s; set ENABLE_AUTO_HEAL=true for an explicitly authorized repair run\n' "$(timestamp)" "${reason}" >> logs/healing.log
    return 0
  fi

  (
    cd "${repo_dir}"
    export PATH="/root/.nvm/versions/node/v22.17.1/bin:/root/.local/bin:/home/kafka/.bun/bin:/usr/local/bin:$PATH"
    export AUTONOMY_TRIGGER="auto-heal"
    echo "[$(timestamp)] --- Auto-Healing Triggered for ${reason} ---" >> logs/healing.log
    "${node_bin}" /usr/local/bin/gemini -m gemini-2.5-flash "${2}" >> logs/healing.log 2>&1
  ) &
}

printf '[%s] INFO  acquiring lock\n' "$(timestamp)"
exec 9>"${lock_file}"
if ! flock -n 9; then
  printf '[%s] WARN  previous run still active, skipping\n' "$(timestamp)"
  exit 0
fi

# Moved notification and reliability logic here
# ---------------------------------------------------------
# Notification logic (Defined early to support Sentinel Mode)
# ---------------------------------------------------------

notify_critical() {
  printf '[%s] CRITICAL %s\n' "$(timestamp)" "$1"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    (
      cd "${repo_dir}"
      DISCORD_ALERT_TYPE="error" DISCORD_ALERT_MESSAGE="$1" "${bun_bin}" src/scripts/send_discord_alert.ts >/dev/null 2>&1 || true
    )
  fi
}

notify_failure() {
  local exit_code=$1
  local duration=$2
  local error_type="Unknown Error"
  local run_log
  run_log="$(current_run_log)"
  
  # Detect specific error patterns in the log
  if printf '%s\n' "${run_log}" | grep -qiE "Permission denied|EACCES|EPERM|operation not permitted|Read-only file system"; then
    error_type="🚨 PERMISSION_ERROR (Root Escalation Issue)"
  elif printf '%s\n' "${run_log}" | grep -qiE "Failed to generate a script passing integrity audits|integrity linter|AUDIT_FAIL"; then
    error_type="🧩 CONTENT_INTEGRITY_ERROR (Audience Fit Issue)"
  elif printf '%s\n' "${run_log}" | grep -qiE "SyntaxError: JSON Parse error|JSON\.parse"; then
    error_type="🧠 LLM_PARSE_ERROR (Logic/Formatting Issue)"
  fi

  local msg="❌ **YT3 Automation ALERT**: Workflow failed (${error_type}) with exit code ${exit_code} after ${duration}s.\nCheck logs/latest.log for details."
  
  # If it's a target error, invoke Gemini CLI autonomously
  if [[ "${error_type}" != "Unknown Error" ]]; then
    msg="${msg}\n\n🤖 **Auto-Healing Initiated**: Invoking Gemini CLI to investigate and patch the root cause autonomously."

    # Run in background to avoid blocking the workflow exit.
    run_auto_heal \
      "${error_type}" \
      "FATAL ERROR: ${error_type}. Read logs/latest.log. Autonomously fix the code or system configuration causing this. You are running in a headless auto-healing context. Do not ask questions. Implement the fix, verify it, and exit."
  fi

  printf '[%s] ERROR %s\n' "$(timestamp)" "${msg}"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    (
      cd "${repo_dir}"
      DISCORD_ALERT_TYPE="error" DISCORD_ALERT_MESSAGE="${msg}" "${bun_bin}" src/scripts/send_discord_alert.ts >/dev/null 2>&1 || true
    )
  fi
}

notify_success() {
  local duration=$1
  local msg="✅ **YT3 Automation SUCCESS**\n🧾 **Proof**: per-publish receipts and alerts are authoritative; aggregate cron does not infer a run\n⏱️ **Duration**: ${duration}s"

  printf '[%s] SUCCESS  %s\n' "$(timestamp)" "${msg}"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    (
      cd "${repo_dir}"
      DISCORD_ALERT_TYPE="success" DISCORD_ALERT_MESSAGE="${msg}" "${bun_bin}" src/scripts/send_discord_alert.ts >/dev/null 2>&1 || true
    )
  fi
}

# Reliability check: Ensure Voicevox is up before starting
check_voicevox() {
  curl -s --max-time 5 http://localhost:50121/version > /dev/null
}

ensure_voicevox_running() {
  if ! check_voicevox; then
    printf '[%s] ERROR Voicevox is not responding. Starting Voicevox...\n' "$(timestamp)"
    # Try to start it using the task up command (Removing silent mode to log errors)
    (cd "${repo_dir}" && task up)
    
    # Log docker state for debugging
    printf '[%s] INFO  Current Docker state for Voicevox:\n' "$(timestamp)"
    docker ps -a --filter name=voicevox-nemo --format "table {{.Names}}\t{{.Status}}\t{{.ID}}" || true

    # Wait for it to become ready (up to 60s)
    for i in {1..12}; do
      printf '[%s] INFO  Waiting for Voicevox (attempt %s/12)...\n' "$(timestamp)" "$i"
      sleep 5
      if check_voicevox; then
        printf '[%s] INFO  Voicevox is now ready.\n' "$(timestamp)"
        return 0
      fi
    done

    notify_critical "🚨 **YT3 Automation FATAL**: Voicevox failed to respond after attempted start. Invoking Auto-Healing..."
    
    # Trigger Gemini CLI to fix Voicevox environment autonomously
    run_auto_heal \
      "VOICEVOX_STARTUP_FAILURE" \
      "FATAL ERROR: Voicevox is not responding. Check docker containers, ports (50121), and system resources. Autonomously fix the issue (e.g., restart docker, kill blocking processes, or recreate container) and ensure it is UP and responding to /version. Then exit."
    
    return 1
  fi
  return 0
}

# State Management: Ensure once-a-day success
readonly today=$(date '+%Y-%m-%d')
readonly automation_state="${log_dir}/automation.json"
# Sentinel Mode: If run during the 08:00 hour, check for success of the 07:00 run.
readonly current_hour=$(date '+%H')
if [ "${current_hour}" = "08" ]; then
  printf '[%s] INFO  Sentinel mode activated (Hour 08). Checking success...\n' "$(timestamp)"
  if [ ! -f "${automation_state}" ]; then
    notify_critical "🚨 **YT3 Sentinel CRITICAL**: State file missing! Workflow likely never ran."
    exit 1
  fi
  
  last_success=$(grep -oP '"last_success_date":\s*"\K[^"]+' "${automation_state}" || true)
  if [ "${last_success}" != "${today}" ]; then
    notify_critical "🚨 **YT3 Sentinel ALERT**: Daily workflow success not detected for today (${today}). Automation may be dead or stuck."
    exit 1
  else
    printf '[%s] INFO  Sentinel verified success for %s. Healthy.\n' "$(timestamp)" "${today}"
    exit 0
  fi
fi

if [ -f "${automation_state}" ]; then
  last_success=$(grep -oP '"last_success_date":\s*"\K[^"]+' "${automation_state}" || true)
  if [ "${last_success}" = "${today}" ]; then
    printf '[%s] INFO  already succeeded today (%s), skipping run.\n' "$(timestamp)" "${today}"
    exit 0
  fi
fi

# Cleanup: Delete logs older than 30 days to save disk space
find "${daily_log_dir}" -name "*.log" -mtime +30 -delete || true

readonly start=${SECONDS}
run_exit=0

# Check Voicevox before proceeding
ensure_voicevox_running || exit 1

printf '[%s] INFO  starting unified agentic loop (pid=%s)\n' "$(timestamp)" "$$"

if (cd "${repo_dir}" && task loop); then
  run_exit=0
  notify_success "${SECONDS}"
else
  run_exit=$?
  notify_failure "${run_exit}" "${SECONDS}"
fi

readonly duration=$(( SECONDS - start ))

outcome="success"
if [ "${run_exit}" -ne 0 ]; then
  outcome="failure"
  printf '[%s] ERROR run failed exit_code=%s duration=%ss\n' "$(timestamp)" "${run_exit}" "${duration}"
else
  printf '[%s] INFO  run finished exit_code=0 duration=%ss\n' "$(timestamp)" "${duration}"
fi

cat >"${status_file}.tmp" <<JSON
{
  "timestamp": "$(timestamp)",
  "status": "${outcome}",
  "exit_code": ${run_exit},
  "duration_seconds": ${duration}
}
JSON
mv "${status_file}.tmp" "${status_file}"

if [ "${outcome}" = "success" ]; then
  # Update automation state on success (Atomic write)
  printf '{\n  "last_success_date": "%s",\n  "last_run_timestamp": "%s"\n}\n' "${today}" "$(timestamp)" > "${automation_state}.tmp"
  mv "${automation_state}.tmp" "${automation_state}"
fi

if [ "${outcome}" != "success" ]; then
  exit "${run_exit}"
fi
