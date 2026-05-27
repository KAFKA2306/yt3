#!/usr/bin/env bash
set -euo pipefail

# 1. 環境とディレクトリの設定
PROJECT_ROOT="/home/kafka/2511youtuber/v3/yt3"
LOG_DIR="${PROJECT_ROOT}/logs"
PROMPT_FILE="${PROJECT_ROOT}/prompts/autonomous_asmr_12h.txt"
PROGRESS_FILE="${PROJECT_ROOT}/asmr/yawa-archive/MASTER_PROGRESS.md"
LOCK_FILE="/tmp/yt3-gemini-asmr.lock"

cd "${PROJECT_ROOT}"
mkdir -p "${LOG_DIR}"

echo "===== $(date -Is) 実行開始 =====" >> "${LOG_DIR}/gemini_asmr_12h.log"

# 2. APIキー環境変数の除去（OAuth枠の強制使用）
# 有料APIキーが存在しても unset して課金を防ぐ
unset GEMINI_API_KEY
unset GEMINI_API_KEY_2
unset GEMINI_API_KEY_3
unset GEMINI_API_KEY_4
unset GEMINI_API_KEY_5
unset GOOGLE_API_KEY
unset GOOGLE_GENAI_USE_VERTEXAI
unset GOOGLE_CLOUD_PROJECT

# 3. OAuth枠の事前確認
BUN_BIN=$(which bun || echo "/home/kafka/.bun/bin/bun")
GEMINI_BIN="/usr/local/bin/gemini"
if ! "${BUN_BIN}" "${GEMINI_BIN}" --version > /dev/null 2>&1; then
  msg="[中止] Gemini CLI の認証（OAuth）が有効ではないか、コマンドが見つかりません。"
  echo "${msg}" >> "${LOG_DIR}/gemini_asmr_12h.log"
  # 権限があれば追記
  [ -w "${PROGRESS_FILE}" ] && echo -e "\n🚨 ${msg}" >> "${PROGRESS_FILE}"
  exit 1
fi

# 4. 二重起動防止とメイン処理
flock -n "${LOCK_FILE}" bash -c "
  {
    echo \"[INFO] 処理を開始します。\"
    # 非対話実行
    \"${BUN_BIN}\" \"${GEMINI_BIN}\" -m gemini-2.5-flash -p \"\$(cat ${PROMPT_FILE})\"
  } >> \"${LOG_DIR}/gemini_asmr_12h.log\" 2>&1
" || {
  msg="[スキップ] 他のプロセスが実行中のため終了します。"
  echo "${msg}" >> "${LOG_DIR}/gemini_asmr_12h.log"
}

echo "===== $(date -Is) 実行終了 =====" >> "${LOG_DIR}/gemini_asmr_12h.log"
