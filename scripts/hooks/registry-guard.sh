#!/usr/bin/env bash
# Re-run the tier and invariant suites whenever the exam registry changes.
#
# WHY THIS EXISTS
# ---------------
# `backend/app/exam/registry.py` declares which module runs on which hardware. Tier tests
# assert that placement, and placement is exactly what clinical work moves — so the tier
# suite has gone stale three separate times, each as a side effect of a clinical amendment
# rather than a deliberate tier change.
#
# The third time nearly removed the two tasks that carry every one of M9's laterality
# features. That would not have reduced coverage; it would have silently converted
# `posterior_vestibular` into a domain that can never satisfy Gate 3, undoing the core
# mechanism of the posterior-circulation amendment for the patients it exists to serve.
#
# So this is enforced rather than remembered. See INV-10 in docs/ARCHITECTURE.md.
#
# Reads the PostToolUse hook payload on stdin and exits 0 unless the suite actually fails,
# in which case it exits 2 so Claude Code surfaces the failure rather than swallowing it.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY="$REPO/backend/.venv/Scripts/python.exe"
[ -x "$PY" ] || PY="$REPO/backend/.venv/bin/python"
LOG="${TMPDIR:-/tmp}/neurotrace-registry-guard.log"

# jq is NOT installed on this machine, so the usual `jq -r '.tool_input.file_path'` hook
# idiom would fail silently and the guard would never fire. Python is guaranteed present —
# it is what runs the tests.
FILE="$("$PY" -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('')
    sys.exit(0)
ti = d.get('tool_input') or {}
tr = d.get('tool_response') or {}
print(ti.get('file_path') or tr.get('filePath') or '')
" 2>/dev/null)"

# Normalise Windows backslashes so the match works whichever form the payload carries.
case "${FILE//\\//}" in
  */backend/app/exam/registry.py) ;;
  *) exit 0 ;;
esac

cd "$REPO/backend" || exit 0

if "$PY" -m pytest tests/test_tiers_wearables_asha.py tests/test_invariants.py \
      -q --tb=line -p no:logging > "$LOG" 2>&1; then
  exit 0
fi

echo "registry.py changed and the tier/invariant suite FAILED."
echo "A module may have been moved without its tier placement being updated (INV-10)."
echo
tail -n 25 "$LOG"
exit 2
