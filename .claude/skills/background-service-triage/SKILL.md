---
name: background-service-triage
description: Triage and monitor background services (systemd user services, Docker containers, Voicevox, Discord bot) and resolve permission or virtualenv issues.
type: skill
---

# Background Service Triage

## Objective

Verify, debug, and restore the operational health of background services, containers, and permission sets within the workspace.

## Workflow

1. **Verify Systemd User Services**:
   - Query user manager units: `su - kafka -c "export XDG_RUNTIME_DIR=/run/user/1000; systemctl --user list-units --all"`
   - Filter for project-specific units: `grep yt3`
   - Retrieve service execution logs: `su - kafka -c "export XDG_RUNTIME_DIR=/run/user/1000; journalctl --user -u <service-name> -n 50 --no-pager"`

2. **Audit Voicevox Container**:
   - Confirm Docker daemon status and check container name: `docker ps -f name=voicevox-nemo`
   - Query HTTP endpoint version: `curl -i http://localhost:50121/version`

3. **Validate Directory and File Ownership**:
   - Scan workspace for files owned by root: `find /home/kafka/2511youtuber/v3/yt3 -user root -o -group root`
   - Correct ownership recursively: `chown -R kafka:kafka /home/kafka/2511youtuber/v3/yt3`

4. **Verify Virtual Environment and Python Libraries**:
   - Check virtual environment executable path: `ls -la .venv/bin`
   - Confirm critical python dependencies are importable: `su - kafka -c "export VIRTUAL_ENV=/home/kafka/2511youtuber/v3/yt3/.venv; .venv/bin/python3 -c 'import speechbrain; import torch; import librosa; import numpy'"`
   - If permissions fail or libraries are missing, recreate local virtualenv: `su - kafka -c "uv venv /home/kafka/2511youtuber/v3/yt3/.venv --python /usr/bin/python3 --allow-existing"`

5. **Restart Target Services**:
   - Issue user-scoped systemd restart command: `su - kafka -c "export XDG_RUNTIME_DIR=/run/user/1000; systemctl --user restart yt3-automation.service"`
