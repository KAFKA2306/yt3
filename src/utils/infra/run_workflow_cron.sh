#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_dir="$(cd "${script_dir}/../../.." && pwd)"

# Ensure correct runtime paths
export PATH="/usr/local/bin:/root/.nvm/versions/node/v22.17.1/bin:$PATH"
readonly bun_bin=$(which bun || echo "/usr/local/bin/bun")

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
readonly status_file="${log_dir}/last_run.json"
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

printf '[%s] INFO  starting workflow run (pid=%s)\n' "$(timestamp)" "$$"

# Reliability check: Ensure Voicevox is up before starting
if ! curl -s --max-time 5 http://localhost:50121/version > /dev/null; then
  printf '[%s] ERROR Voicevox is not responding. Starting Voicevox...\n' "$(timestamp)"
  # Try to start it using the task up command but silently
  cd "${repo_dir}" && task up > /dev/null 2>&1
  sleep 10
  if ! curl -s --max-time 5 http://localhost:50121/version > /dev/null; then
    printf '[%s] FATAL Voicevox failed to start. Aborting to avoid incomplete video.\n' "$(timestamp)"
    exit 1
  fi
fi

# Cleanup: Delete logs older than 30 days to save disk space
find "${daily_log_dir}" -name "*.log" -mtime +30 -delete || true

readonly start=${SECONDS}
run_exit=0

# Notification logic
notify_critical() {
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    curl -H "Content-Type: application/json" -d "{\"content\": \"$1\"}" "${DISCORD_WEBHOOK_URL}"
  fi
}

notify_failure() {
  local msg="❌ **YT3 Automation ALERT**: Workflow failed with exit code $1 after ${2}s. Check logs/latest.log for details."
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    curl -H "Content-Type: application/json" -d "{\"content\": \"${msg}\"}" "${DISCORD_WEBHOOK_URL}"
  fi
}

notify_success() {
  local duration=$1
  local state_file=$2
  local title="Unknown Title"
  local video_url=""
  
  if [ -f "${state_file}" ]; then
    title=$(grep -oP '"title":\s*"\K[^"]+' "${state_file}" | head -n 1 || echo "Unknown Title")
    video_id=$(grep -oP '"video_id":\s*"\K[^"]+' "${state_file}" | head -n 1 || echo "")
    if [ -n "${video_id}" ] && [ "${video_id}" != "dry_run_id" ]; then
      video_url="https://youtu.be/${video_id}"
    fi
  fi

  local msg="✅ **YT3 Automation SUCCESS**\n🎬 **Title**: ${title}\n🔗 **URL**: ${video_url:-"Dry Run / Pending"}\n⏱️ **Duration**: ${duration}s"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    curl -H "Content-Type: application/json" -d "{\"content\": \"${msg}\"}" "${DISCORD_WEBHOOK_URL}"
  fi
}

if (cd "${repo_dir}" && "${bun_bin}" --env-file=config/.env src/index.ts); then
  run_exit=0
  
  # Find latest run state for notification
  latest_run=$(ls -td "${repo_dir}/runs/"*/ | head -n 1 || echo "")
  state_file="${latest_run}state.json"
  
  notify_success "${SECONDS}" "${state_file}"
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
