#!/bin/bash

VOICEVOX_PORT="${VOICEVOX_PORT:-50121}"
VOICEVOX_CONTAINER_NAME="${VOICEVOX_CONTAINER_NAME:-voicevox-nemo}"
VOICEVOX_SPEAKER="${VOICEVOX_SPEAKER:-1}"
VOICEVOX_IMAGE="${VOICEVOX_IMAGE:-voicevox/voicevox_engine:cpu-ubuntu20.04-latest}"
VOICEVOX_HEALTHCHECK_PATH="${VOICEVOX_HEALTHCHECK_PATH:-/health}"
VOICEVOX_START_TIMEOUT="${VOICEVOX_START_TIMEOUT:-90}"
VOICEVOX_PULL_RETRIES="${VOICEVOX_PULL_RETRIES:-3}"
VOICEVOX_HEALTH_INTERVAL="${VOICEVOX_HEALTH_INTERVAL:-10s}"
VOICEVOX_HEALTH_TIMEOUT="${VOICEVOX_HEALTH_TIMEOUT:-3s}"
VOICEVOX_HEALTH_RETRIES="${VOICEVOX_HEALTH_RETRIES:-5}"
VOICEVOX_HEALTH_START_PERIOD="${VOICEVOX_HEALTH_START_PERIOD:-20s}"
VOICEVOX_CPU_LIMIT="${VOICEVOX_CPU_LIMIT:-}"
VOICEVOX_MEMORY_LIMIT="${VOICEVOX_MEMORY_LIMIT:-}"
VOICEVOX_RESTART_POLICY="${VOICEVOX_RESTART_POLICY:-unless-stopped}"
VOICEVOX_STOP_TIMEOUT="${VOICEVOX_STOP_TIMEOUT:-20}"
LOG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/logs"
VOICEVOX_LOG="${LOG_DIR}/voicevox_nemo.log"

mkdir -p "${LOG_DIR}"

status() {
    docker ps -q --filter "name=^/${VOICEVOX_CONTAINER_NAME}$"
}

start() {
    docker rm -f "${VOICEVOX_CONTAINER_NAME}" >/dev/null 2>&1
    docker pull "${VOICEVOX_IMAGE}" >/dev/null 2>&1
    local docker_args=(
        -d
        --name "${VOICEVOX_CONTAINER_NAME}"
        --restart "${VOICEVOX_RESTART_POLICY}"
        -p "${VOICEVOX_PORT}:50021"
        --health-cmd "wget -q -O /dev/null http://localhost:50021${VOICEVOX_HEALTHCHECK_PATH} || exit 1"
        --health-interval "${VOICEVOX_HEALTH_INTERVAL}"
        --health-retries "${VOICEVOX_HEALTH_RETRIES}"
        --health-timeout "${VOICEVOX_HEALTH_TIMEOUT}"
        --health-start-period "${VOICEVOX_HEALTH_START_PERIOD}"
    )
    if [ -n "${VOICEVOX_CPU_LIMIT}" ]; then
        docker_args+=(--cpus "${VOICEVOX_CPU_LIMIT}")
    fi
    if [ -n "${VOICEVOX_MEMORY_LIMIT}" ]; then
        docker_args+=(--memory "${VOICEVOX_MEMORY_LIMIT}")
    fi
    docker_args+=("${VOICEVOX_IMAGE}")
    docker run "${docker_args[@]}" >/dev/null 2>&1
    sleep 10
}

stop() {
    docker stop --time "${VOICEVOX_STOP_TIMEOUT}" "${VOICEVOX_CONTAINER_NAME}" >/dev/null 2>&1
}

restart() {
    stop
    sleep 2
    start
}

logs() {
    docker logs "${VOICEVOX_CONTAINER_NAME}"
}

test() {
    local test_text="こんにちは、音声合成のテストです。"
    local output_file="${LOG_DIR}/voicevox_test.wav"
    local encoded_text=$(echo -n "$test_text" | python3 -c "import sys; from urllib.parse import quote; print(quote(sys.stdin.read()))")
    local query=$(wget -qO- -S -X POST \
        "http://localhost:${VOICEVOX_PORT}/audio_query?text=${encoded_text}&speaker=${VOICEVOX_SPEAKER}")
    wget -qO- -S -X POST \
        -H "Content-Type: application/json" \
        -d "$query" \
        "http://localhost:${VOICEVOX_PORT}/synthesis?speaker=${VOICEVOX_SPEAKER}" \
        -o "${output_file}"
}

main() {
    case "${1:-}" in
        start)
        start
            ;;
        stop)
            stop
            ;;
        restart)
            restart
            ;;
        status)
            status
            ;;
        logs)
            logs
            ;;
        test)
            test
            ;;
        *)
            echo "Usage: $0 {start|stop|restart|status|logs|test}"
            exit 1
            ;;
    esac
}

main "$@"
