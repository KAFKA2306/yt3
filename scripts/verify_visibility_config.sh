#!/bin/bash
set -e

echo "=== YouTube Visibility Configuration Verification ==="

# 1. Check for hardcoded privacyStatus in src/ (excluding types and legitimate usages)
# Legitimate usages:
# - src/domain/agents/publish.ts (reading from config)
# - src/io/utils/infra/ensure_public.ts (reading from config)
# - src/domain/config_types.ts (interface definition)
# - src/domain/config/app.ts (interface definition)
# - src/domain/types.ts (zod schema/types)

echo "Checking for hardcoded privacyStatus strings..."
HARDCODED=$(grep -r 'privacyStatus: "' src/ | grep -v 'ytCfg.default_visibility' | grep -v 'visibility' || true)

if [ -n "$HARDCODED" ]; then
    echo "FAIL: Found hardcoded privacyStatus values:"
    echo "$HARDCODED"
    exit 1
else
    echo "PASS: No hardcoded privacyStatus values found (except allowed config references)."
fi

# 2. Check for YOUTUBE_DEFAULT_VISIBILITY in config/
echo "Checking for YOUTUBE_DEFAULT_VISIBILITY in config/..."
ENV_VARS=$(grep -r "YOUTUBE_DEFAULT_VISIBILITY" config/ | grep -v "default.yaml" || true)

if [ -n "$ENV_VARS" ]; then
    echo "FAIL: Found YOUTUBE_DEFAULT_VISIBILITY in config/ files:"
    echo "$ENV_VARS"
    exit 1
else
    echo "PASS: No YOUTUBE_DEFAULT_VISIBILITY found in .env files."
fi

# 3. Verify publish.ts uses cfg.youtube.default_visibility
echo "Verifying src/domain/agents/publish.ts usage..."
if grep -q "privacyStatus: ytCfg.default_visibility" src/domain/agents/publish.ts; then
    echo "PASS: src/domain/agents/publish.ts uses config."
else
    echo "FAIL: src/domain/agents/publish.ts does NOT use config for privacyStatus."
    exit 1
fi

# 4. Verify runtime logging in publish.ts
echo "Verifying runtime logging in src/domain/agents/publish.ts..."
if grep -q "\[PUBLISH:CONFIG\] visibility=\${ytCfg.default_visibility} source=config/default.yaml" src/domain/agents/publish.ts; then
    echo "PASS: src/domain/agents/publish.ts includes required logging."
else
    echo "FAIL: src/domain/agents/publish.ts is missing required logging."
    exit 1
fi

echo "=== All checks passed! ==="
