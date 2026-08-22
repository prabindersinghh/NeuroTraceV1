#!/usr/bin/env bash
# Pre-push safety gate. Run BEFORE every `git push`.
#
# This repository sits in a directory that also contains 22 photographs of a real person's
# hospital records. They are gitignored and were never committed — established by
# reachability analysis, not assumption — but the working tree is one `git add -A` away from
# publishing somebody's medical records to a public GitHub repo, permanently and
# irreversibly.
#
# So this runs first, every time. It is cheap and the failure it prevents is not recoverable.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

pass=0; fail=0
ok()  { echo "  PASS  $*"; pass=$((pass+1)); }
bad() { echo "  FAIL  $*"; fail=$((fail+1)); }
step(){ printf '\n\033[1m%s\033[0m\n' "$*"; }

step "1 · nothing image-like is staged or tracked"
tracked=$(git ls-files | grep -icE '\.(jpe?g|png|heic|tiff?)$|stroke.?report' || true)
[ "$tracked" -eq 0 ] && ok "no image or report file tracked" \
  || { bad "$tracked image/report file(s) TRACKED"; git ls-files | grep -iE '\.(jpe?g|png)$|stroke.?report' | head; }

staged=$(git diff --cached --name-only | grep -icE '\.(jpe?g|png|heic|tiff?)$|stroke.?report' || true)
[ "$staged" -eq 0 ] && ok "nothing image-like staged" || bad "$staged image file(s) STAGED"

step "2 · the source folder is ignored"
if [ -d "real stroke report" ]; then
  sample=$(find "real stroke report" -type f | head -1)
  if [ -n "$sample" ] && git check-ignore -q "$sample"; then
    ok "source folder is gitignored"
  else
    bad "source folder is NOT ignored — do not push"
  fi
else
  ok "source folder not present on this machine"
fi

step "3 · no image blob recoverable from the object store"
imgs=0
while read -r sha size; do
  [ "${size:-0}" -gt 20000 ] || continue
  magic=$(git cat-file blob "$sha" 2>/dev/null | head -c 4 | od -An -tx1 | tr -d ' \n')
  case "$magic" in ffd8ff*|89504e47) imgs=$((imgs+1)) ;; esac
done < <(git cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname) %(objectsize)' 2>/dev/null | awk '$1=="blob"{print $2, $3}')
[ "$imgs" -eq 0 ] && ok "no image blob in the object store" \
  || bad "$imgs image blob(s) recoverable — run: git reflog expire --expire-unreachable=now --all && git gc --prune=now"

step "4 · no image in any reachable commit, ever"
hist=$(git rev-list --objects --all 2>/dev/null | awk '{print $2}' | grep -icE '\.(jpe?g|png)$|stroke.?report' || true)
[ "$hist" -eq 0 ] && ok "no image path in any reachable commit" \
  || bad "images exist in history — rewrite required, not just a delete"

step "5 · privacy invariants pass (INV-11)"
if (cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_privacy.py -q \
      -p no:logging --tb=line >/dev/null 2>&1); then
  ok "tests/test_privacy.py green"
else
  bad "privacy invariants FAILING — do not push"
fi

step "6 · no secret-shaped string in what is about to be pushed"
# Names only, never values, is the rule everywhere in this project.
if git grep -nIE '(SECRET|PASSWORD|API_KEY|TOKEN)\s*=\s*["'"'"'][^"'"'"']{12,}' -- \
     ':!*test*' ':!*.md' 2>/dev/null | grep -v "change-me-in-env-file" | head -5; then
  bad "a hard-coded secret-shaped value appears above"
else
  ok "no hard-coded secret-shaped values"
fi

printf '\n\033[1mPREFLIGHT: %d passed, %d failed\033[0m\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then
  echo "DO NOT PUSH." >&2
  exit 1
fi
echo "Safe to push."
