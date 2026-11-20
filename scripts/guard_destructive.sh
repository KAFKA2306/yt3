#!/usr/bin/env bash
set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="runs/destructive_guard/$TS"
mkdir -p "$RUN_DIR"

git status --porcelain=v1 > "$RUN_DIR/git_status.txt" 2>/dev/null || true
git ls-files --others --exclude-standard > "$RUN_DIR/untracked.txt" 2>/dev/null || true
git diff --name-only > "$RUN_DIR/modified.txt" 2>/dev/null || true

CHECK_DIRS=()
for d in artifacts dist/artifacts generated tmp; do
  if [ -d "$d" ]; then
    CHECK_DIRS+=("$d")
  fi
done

if [ ${#CHECK_DIRS[@]} -gt 0 ]; then
  find "${CHECK_DIRS[@]}" -type f \
    \( -name "*.png" -o -name "*.webp" -o -name "*.jpg" -o -name "*.jpeg" \) \
    2>/dev/null > "$RUN_DIR/image_candidates.txt" || true
else
  touch "$RUN_DIR/image_candidates.txt"
fi

grep -E '\.(png|webp|jpg|jpeg)$' "$RUN_DIR/untracked.txt" \
  > "$RUN_DIR/untracked_images.txt" || true

touch "$RUN_DIR/unregistered_artifacts.txt"
if [ -d "artifacts" ]; then
  while IFS= read -r file; do
    if [ -f "$file" ] && [ "$(basename "$file")" != ".gitkeep" ]; then
      rel_path="${file#./}"
      if [ -f "db/evolution.db" ]; then
        count=$(sqlite3 db/evolution.db "SELECT COUNT(*) FROM raw_artifacts WHERE raw_path LIKE '%$rel_path%' OR raw_path LIKE '%$(basename "$file")%';" 2>/dev/null || echo "0")
        if [ "$count" -eq 0 ]; then
          echo "$file" >> "$RUN_DIR/unregistered_artifacts.txt"
        fi
      else
        echo "$file" >> "$RUN_DIR/unregistered_artifacts.txt"
      fi
    fi
  done < <(find artifacts -type f 2>/dev/null)
fi

if command -v jq &>/dev/null; then
  jq -n \
    --arg ts "$TS" \
    --arg commit "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')" \
    --arg branch "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')" \
    --argfile mod <(git diff --name-only 2>/dev/null | jq -R . | jq -s .) \
    --argfile untracked <(git ls-files --others --exclude-standard 2>/dev/null | jq -R . | jq -s .) \
    '{timestamp: $ts, git_commit: $commit, git_branch: $branch, modified_files: $mod, untracked_files: $untracked}' \
    > "$RUN_DIR/backup_manifest.json" 2>/dev/null || echo "{\"timestamp\": \"$TS\"}" > "$RUN_DIR/backup_manifest.json"
else
  echo "{\"timestamp\": \"$TS\"}" > "$RUN_DIR/backup_manifest.json"
fi

FAILED=0

if grep -q '^db/prompts.json$' "$RUN_DIR/modified.txt"; then
  echo "FAIL: db/prompts.json is modified. Evidence: $RUN_DIR" >&2
  FAILED=1
fi

if [ -s "$RUN_DIR/untracked_images.txt" ]; then
  echo "FAIL: untracked image artifacts exist. Evidence: $RUN_DIR" >&2
  cat "$RUN_DIR/untracked_images.txt" >&2
  FAILED=1
fi

if [ -s "$RUN_DIR/unregistered_artifacts.txt" ]; then
  echo "FAIL: artifacts/ contains unregistered files. Evidence: $RUN_DIR" >&2
  cat "$RUN_DIR/unregistered_artifacts.txt" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "PASS: destructive preflight clear. Evidence: $RUN_DIR"
exit 0
