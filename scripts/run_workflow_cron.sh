#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_dir="$(cd "${script_dir}/.." && pwd)"
readonly log_dir="${repo_dir}/logs"
readonly log_file="${log_dir}/cron.log"
readonly status_file="${log_dir}/last_run.json"
readonly lock_file="${log_dir}/cron.lock"
readonly uv_bin="${UV_BIN:-/home/kafka/.local/bin/uv}"

mkdir -p "${log_dir}"
exec >>"${log_file}" 2>&1

timestamp() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

printf '[%s] INFO  acquiring lock\n' "$(timestamp)"
exec 9>"${lock_file}"
if ! flock -n 9; then
  printf '[%s] WARN  previous run still active, skipping\n' "$(timestamp)"
  exit 0
fi

printf '[%s] INFO  starting workflow run (pid=%s)\n' "$(timestamp)" "$$"
readonly start=${SECONDS}
run_exit=0

if (cd "${repo_dir}" && "${uv_bin}" run python -m src.main); then
  run_exit=0
else
  run_exit=$?
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

if [ "${outcome}" != "success" ]; then
  exit "${run_exit}"
fi
