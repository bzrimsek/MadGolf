#!/bin/sh
# MadGolf pre-push gate.
# Install:  cp git-pre-push-hook.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push
# Then a push that fails audit or tests is physically blocked — the gate can't be forgotten.

python3 ship.py index.html
if [ $? -ne 0 ]; then
  echo ""
  echo "✗ Push blocked — the ship gate failed (see above). Fix it, then push again."
  echo "  (To bypass in a real emergency only:  git push --no-verify)"
  exit 1
fi
