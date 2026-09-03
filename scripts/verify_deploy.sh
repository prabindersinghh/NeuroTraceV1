#!/usr/bin/env bash
# Verify a DEPLOYED NeuroTrace instance reproduces the local demo exactly.
#
#   ./scripts/verify_deploy.sh https://your-app.up.railway.app
#
# This is the check that closes the single largest risk in the project: everything works on
# one machine and nowhere else. It does not test that the server responds — it tests that
# the CLINICAL ENGINE produces the same answer on the deployed instance as it does locally,
# band for band and gate for gate.
#
# A deploy that returns 200 on /health and a different band sequence is a broken deploy that
# looks healthy, which is worse than one that will not start.
set -uo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "usage: $0 https://your-app.up.railway.app" >&2
  exit 2
fi
BASE="${BASE%/}"

pass=0; fail=0
ok()   { echo "  PASS  $*"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $*"; fail=$((fail+1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# The values the local instance produces. Any difference is a real difference.
#
# Re-derived 2026-08-30 by running `seed_demo` against a fresh local database and reading
# the result, THEN confirming the deployed instance matches — in that order, so this is the
# local truth and not the deployed output copied back into its own expectation. The previous
# value (`...SSWAA`, a WATCH on day 19) predates the Part 3 baseline-confirmation work:
# the baseline now confirms ON day 19, so that session no longer scores a band of its own.
# Both sides now produce nineteen STABLE then two ALERT.
EXPECT_BANDS="SSSSSSSSSSSSSSSSSSSAA"
EXPECT_FINAL="ALERT"
EXPECT_LATERAL="cranial_nerves,motor"

step "1 · health"
health=$(curl -fsS --max-time 30 "$BASE/health" 2>/dev/null) \
  && ok "health responds: $health" \
  || { bad "health endpoint unreachable — nothing else can be checked"; exit 1; }

step "2 · migrations ran (schema is at head)"
# The FAST card is unauthenticated and reads no patient data, so it is the cheapest proof
# the app booted with a working database behind it.
if curl -fsS --max-time 30 "$BASE/safety/fast?lang=pa" | grep -q "ਮਦਦ"; then
  ok "FAST card served in Punjabi (app + DB + i18n all live)"
else
  bad "FAST card missing or not localised"
fi

step "3 · CORS is locked to the frontend origin"
cors=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 30 \
  -H "Origin: https://definitely-not-our-frontend.example" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS "$BASE/auth/login" 2>/dev/null)
hdr=$(curl -fsSI --max-time 30 -H "Origin: https://definitely-not-our-frontend.example" \
  "$BASE/health" 2>/dev/null | grep -i "access-control-allow-origin" || true)
if echo "$hdr" | grep -qi "definitely-not-our-frontend"; then
  bad "CORS echoes an arbitrary origin — it is not locked ($cors)"
else
  ok "CORS does not accept an arbitrary origin"
fi

step "4 · no endpoint accepts raw media (INV-1, checked against the live API)"
spec=$(curl -fsS --max-time 30 "$BASE/openapi.json" 2>/dev/null || echo "{}")
if echo "$spec" | grep -qi "multipart/form-data"; then
  bad "the live OpenAPI schema advertises a multipart endpoint — INV-1 is broken IN PRODUCTION"
else
  ok "no multipart endpoint in the live schema"
fi

step "5 · seed the demo"
# 180s was not enough and the failure was indistinguishable from a real one: the seed runs
# 21 days through the full engine and took 3m06s against a cold Neon instance, so curl
# aborted and this reported "demo seed failed (is DEMO_MODE=true?)" — sending three deploys
# chasing a DEMO_MODE flag that was never the problem. Check 6 then compared an empty string
# and reported the engine as behaving differently. A timeout must not read as a wrong answer.
seeded=$(curl -fsS --max-time 600 -X POST "$BASE/demo/seed" 2>/dev/null || echo "")
if [ -z "$seeded" ]; then
  bad "demo seed failed (is DEMO_MODE=true?)"
else
  ok "demo seeded"
fi

step "6 · THE ONE THAT MATTERS — identical band sequence"
bands=$(echo "$seeded" | python -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
print(''.join(b[0] if b!='PATTERN_ATYPICAL' else 'X' for b in d.get('bands',[])))
" 2>/dev/null)
final=$(echo "$seeded" | python -c "
import json,sys
try: print(json.load(sys.stdin).get('bands',[''])[-1])
except Exception: print('')
" 2>/dev/null)

echo "  local  : $EXPECT_BANDS -> $EXPECT_FINAL"
echo "  deployed: ${bands:-<none>} -> ${final:-<none>}"
[ "$bands" = "$EXPECT_BANDS" ] && ok "band sequence identical to local" \
  || bad "band sequence DIFFERS — the engine behaves differently in production"
[ "$final" = "$EXPECT_FINAL" ] && ok "final band is $EXPECT_FINAL" \
  || bad "final band is '${final:-none}', expected $EXPECT_FINAL"

step "7 · gate states and laterality identical"
echo "  (needs a clinician login; see DEPLOY.md step 7 for the manual check)"

printf '\n\033[1mRESULT: %d passed, %d failed\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
