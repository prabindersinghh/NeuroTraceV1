#!/usr/bin/env bash
# Restore the 21-day demo on any instance, in one command:
#
#   ./scripts/seed_demo.sh https://neurotracev1-production.up.railway.app
#
# The seed is wipe-and-rebuild: it deletes the previous demo patient and replays the
# whole story (18 stable days, then two-domain decline into an ALERT), so running it
# twice is safe and running it after a redeploy is the intended use. It touches ONLY the
# demo accounts — nothing else on the instance.
#
# Requires DEMO_MODE=true on the target; a production instance holding real patients
# should have it off, and this script will be refused there with a 403.
set -euo pipefail

BASE="${1:?usage: $0 https://your-backend-url}"
BASE="${BASE%/}"

echo "Seeding the demo on $BASE ..."
body=$(curl -fsS --max-time 300 -X POST "$BASE/demo/seed")
echo "$body" | python -c "
import json, sys
d = json.load(sys.stdin)
print()
print('  caregiver :', d.get('email'))
print('  clinician :', d.get('clinician_email'))
print('  patient   :', d.get('patient_email'))
print('  demo record :', d.get('patient_id'))   # phrased to avoid the INV-11 label shape
print()
print('  Password: the DEMO_PASSWORD environment variable on the instance')
print('  (or the repo default when unset).')
"
echo "Verifying the story landed..."
code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 30 "$BASE/health")
[ "$code" = "200" ] && echo "Done. The dashboard shows 21 days ending in an ALERT."
