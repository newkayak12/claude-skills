#!/usr/bin/env bash
# A Claude Code session with teams and the skills its stages use, straight from this checkout -
# no marketplace install, no teams:install in the project. Run it from the project root:
#
#   ~/projects/claude-skills/teams/scripts/teams-session.sh [claude args...]
#
# Task state: ~/.harness/tasks (HARNESS_TASKS_DIR); run logs: ~/.local/share/teams-runs
# (TEAMS_RUNS_DIR, =off to disable). A .claude/team.json in the project, if present, is read.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARGS=(--plugin-dir "$REPO/teams")
for p in develop think cognition completion write agents; do
  [ -d "$REPO/$p" ] && ARGS+=(--plugin-dir "$REPO/$p")
done
exec claude "${ARGS[@]}" "$@"
