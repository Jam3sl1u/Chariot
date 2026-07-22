#!/usr/bin/env bash
# Drives the Chariot build loop unattended across many turns.
#
# Why this exists: Codex CLI has no native "keep going across turns until done" feature and no
# turn/token budget cap (verified against the official docs — see AGENTS.md). GOAL.md's cycle is
# designed as one row per `codex exec` invocation, so "unattended for everything" means an external
# driver re-invoking codex, not a single long-running codex session. This script is that driver.
#
# Usage:
#   ./scripts/run-loop.sh                 # run with defaults
#   MAX_TURNS=200 ./scripts/run-loop.sh    # override the safety cap
#   STALL_LIMIT=5 ./scripts/run-loop.sh    # override how many stuck turns before halting
#
# Safe to stop (Ctrl+C) and re-run at any time — state lives in .prd_loop/PROGRESS.md and git
# history, not in this script or in Codex's session memory.

set -euo pipefail
cd "$(dirname "$0")/.."

MAX_TURNS="${MAX_TURNS:-80}"
STALL_LIMIT="${STALL_LIMIT:-3}"
LOG_DIR="run-logs"
PROGRESS_FILE=".prd_loop/PROGRESS.md"

mkdir -p "$LOG_DIR"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI not found on PATH. Install it first:"
  echo "  npm install -g @openai/codex"
  echo "  (or: brew install --cask codex)"
  echo "Then run 'codex' once to sign in before using this script."
  exit 1
fi

done_count() {
  grep -cE '^\| [0-9]+ \| [0-9]+ \| .* \| (Done|Skipped|N/A) \|' "$PROGRESS_FILE" || true
}

is_complete() {
  ! grep -qE '^\| [0-9]+ \| [0-9]+ \| .* \| (Missing|In Progress) \|' "$PROGRESS_FILE"
}

BUILD_PROMPT='Read AGENTS.md if you have not already this session — it governs when to proceed
alone versus stop and ask, and lists a mandatory self-check to run before ending this turn. Read
.prd_loop/GOAL.md and .prd_loop/CHECKLIST.md in full, then .prd_loop/PROGRESS.md for current
status. Work the next Missing row per GOAL.md plan-build-test-commit-push cycle, respecting
CHECKLIST.md dependency order. Actually execute the row'"'"'s tests and show real output — do not
assert they pass without having run them this turn. If you hit an AGENTS.md Tier 2 situation, log
it in PROGRESS.md (Open questions blocking progress, or Escalations to human) and stop this turn
rather than guessing — do not fabricate an answer. Run AGENTS.md'"'"'s pre-turn-end self-check,
then update PROGRESS.md before finishing regardless of outcome.'

VERIFY_PROMPT='Check .prd_loop/PROGRESS.md Turn log for the row(s) touched in the most recent
commit. Independently re-read documentation/Chariot_PRD_v1.3.md for that row'"'"'s requirement
IDs (not CHECKLIST.md'"'"'s paraphrase). Re-run the row'"'"'s actual test command yourself — do not
take the build turn'"'"'s claimed output on faith — and confirm the diff and the real test output
match the PRD text, citing specifics (file/line, exact command, pass/fail counts). Update
PROGRESS.md'"'"'s Verifier check column and status accordingly — only Done if it genuinely
matches and you personally observed the tests pass.'

last_done=-1
stall_streak=0

for ((turn = 1; turn <= MAX_TURNS; turn++)); do
  if is_complete; then
    echo "=== PROGRESS.md shows no Missing/In Progress rows — build loop complete. ==="
    exit 0
  fi

  ts="$(date +%Y%m%d-%H%M%S)"
  echo "=== Turn $turn ($ts) — build ==="
  codex --profile build exec "$BUILD_PROMPT" 2>&1 | tee "$LOG_DIR/turn-${turn}-build-${ts}.log"

  echo "=== Turn $turn ($ts) — verify ==="
  codex --profile verifier exec "$VERIFY_PROMPT" 2>&1 | tee "$LOG_DIR/turn-${turn}-verify-${ts}.log"

  current_done="$(done_count)"
  if [ "$current_done" -eq "$last_done" ]; then
    stall_streak=$((stall_streak + 1))
  else
    stall_streak=0
  fi
  last_done="$current_done"

  if [ "$stall_streak" -ge "$STALL_LIMIT" ]; then
    echo "=== No progress for $STALL_LIMIT consecutive turns — halting. ==="
    echo "This almost always means something is logged under 'Escalations to human' or 'Open"
    echo "questions blocking progress' in $PROGRESS_FILE that needs your decision. Check there,"
    echo "answer it, then re-run this script — it picks up wherever it left off."
    echo
    echo "--- Row(s) still Missing / In Progress ---"
    grep -E '^\| [0-9]+ \| [0-9]+ \| .* \| (Missing|In Progress) \|' "$PROGRESS_FILE" || true
    echo
    echo "--- Current escalations/open questions ---"
    awk '/## Open questions/,/## Turn log/' "$PROGRESS_FILE"
    awk '/## Escalations to human/,0' "$PROGRESS_FILE"
    exit 2
  fi
done

echo "=== Reached MAX_TURNS ($MAX_TURNS) without completing. ==="
echo "Not necessarily stuck — check $PROGRESS_FILE's Turn log for real progress, then re-run with"
echo "a higher MAX_TURNS if it's still legitimately working through rows."
exit 3
