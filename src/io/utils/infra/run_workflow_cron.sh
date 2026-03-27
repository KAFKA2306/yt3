#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_dir="$(cd "${script_dir}/../../../../" && pwd)"

# Ensure correct runtime paths
export PATH="/root/.local/bin:/home/kafka/.bun/bin:/usr/local/bin:$PATH"
readonly bun_bin=$(which bun || echo "/home/kafka/.bun/bin/bun")

# Load environment variables for Discord notifications from bash
if [ -f "${repo_dir}/config/.env" ]; then
  # Sourcing safely: ignoring comments and empty lines
  export $(grep -v '^#' "${repo_dir}/config/.env" | xargs)
fi
readonly log_dir="${repo_dir}/data/state"
readonly daily_log_dir="${repo_dir}/logs/daily"
readonly today_date=$(date '+%Y-%m-%d')
readonly log_file="${daily_log_dir}/${today_date}.log"
readonly latest_log="${repo_dir}/logs/latest.log"
readonly status_file="${repo_dir}/data/state/last_run.json"
readonly lock_file="${repo_dir}/logs/cron.lock"
readonly uv_bin="${UV_BIN:-/root/.local/bin/uv}"

mkdir -p "${log_dir}" "${daily_log_dir}"
exec >>"${log_file}" 2>&1

# Symlink latest for easy access
ln -sf "${log_file}" "${latest_log}"

timestamp() {
  date '+%Y-%m-%dT%H:%M:%S%z'
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
    curl -s -H "Content-Type: application/json" -d "{\"content\": \"$1\"}" "${DISCORD_WEBHOOK_URL}" > /dev/null || true
  fi
}

notify_failure() {
  local exit_code=$1
  local duration=$2
  local error_type="Unknown Error"
  
  # Detect specific error patterns in the log
  if grep -qiE "Permission denied|EACCES|operation not permitted" "${log_file}"; then
    error_type="🚨 PERMISSION_ERROR (Root Escalation Issue)"
  elif grep -qiE "SyntaxError: JSON Parse error|JSON\.parse" "${log_file}"; then
    error_type="🧠 LLM_PARSE_ERROR (Logic/Formatting Issue)"
  fi

  local msg="❌ **YT3 Automation ALERT**: Workflow failed (${error_type}) with exit code ${exit_code} after ${duration}s.\nCheck logs/latest.log for details."
  
  # If it's a target error, invoke Gemini CLI autonomously
  if [[ "${error_type}" != "Unknown Error" ]]; then
    msg="${msg}\n\n🤖 **Auto-Healing Initiated**: Invoking Gemini CLI to investigate and patch the root cause autonomously."
    
    # Run in background to avoid blocking the workflow exit
    (
      cd "${repo_dir}"
      export PATH="/root/.local/bin:/home/kafka/.bun/bin:/usr/local/bin:$PATH"
      echo "[$(timestamp)] --- Auto-Healing Triggered for ${error_type} ---" >> logs/healing.log
      gemini "FATAL ERROR: ${error_type}. Read logs/latest.log. Autonomously fix the code or system configuration causing this. You are running in a headless auto-healing context. Do not ask questions. Implement the fix, verify it, and exit." >> logs/healing.log 2>&1
    ) &
  fi

  printf '[%s] ERROR %s\n' "$(timestamp)" "${msg}"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    curl -s -H "Content-Type: application/json" -d "{\"content\": \"${msg}\"}" "${DISCORD_WEBHOOK_URL}" > /dev/null || true
  fi
}

notify_success() {
  local duration=$1
  local latest_run=$2
  local title="Unknown Title"
  local video_url=""

  if [ -f "${latest_run}content/output.yaml" ]; then
    title=$(grep -oP 'title:\s*\K.+' "${latest_run}content/output.yaml" | head -n 1 || echo "Unknown Title")
  fi
  if [ -f "${latest_run}publish/output.yaml" ]; then
    local video_id
    video_id=$(grep -oP 'video_id:\s*\K.+' "${latest_run}publish/output.yaml" | head -n 1 || echo "")
    if [ -n "${video_id}" ]; then
      video_url="https://youtu.be/${video_id}"
    fi
  fi

  local msg="✅ **YT3 Automation SUCCESS**\n🎬 **Title**: ${title}\n🔗 **URL**: ${video_url:-"(no URL)"}\n⏱️ **Duration**: ${duration}s"
  printf '[%s] INFO  %s\n' "$(timestamp)" "${msg}"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    curl -s -H "Content-Type: application/json" -d "{\"content\": \"${msg}\"}" "${DISCORD_WEBHOOK_URL}" > /dev/null || true
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
    (cd "${repo_dir}" && docker rm -f voicevox-nemo || true && docker run -d --name voicevox-nemo --restart unless-stopped -p 50121:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest && systemctl --user start yt3-aim.service && systemctl --user start yt3-discord.service)
    
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
    (
      cd "${repo_dir}"
      export PATH="/root/.local/bin:/home/kafka/.bun/bin:/usr/local/bin:$PATH"
      echo "[$(timestamp)] --- Auto-Healing Triggered for VOICEVOX_STARTUP_FAILURE ---" >> logs/healing.log
      gemini "FATAL ERROR: Voicevox is not responding. Check docker containers, ports (50121), and system resources. Autonomously fix the issue (e.g., restart docker, kill blocking processes, or recreate container) and ensure it is UP and responding to /version. Then exit." >> logs/healing.log 2>&1
    ) &
    
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

printf '[%s] INFO  starting workflow run (pid=%s)\n' "$(timestamp)" "$$"

if (cd "${repo_dir}" && "${bun_bin}" --env-file=config/.env src/index.ts); then
  run_exit=0
  
  latest_run=$(ls -td "${repo_dir}/runs/"*/ | head -n 1 || echo "")
  notify_success "${SECONDS}" "${latest_run}"
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
  printf '[%s] INFO  run finished status=success exit_code=0 duration=%ss\n' "$(timestamp)" "${duration}"
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
