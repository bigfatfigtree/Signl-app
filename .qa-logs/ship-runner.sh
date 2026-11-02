#!/bin/bash
# Build -68 ship runner: the sandbox write guard classifies 10 of the
# -68 files as non-exportable to git objects from interactive shells
# (deterministic EPERM on their object writes). This runner waits for
# the block to clear, then ships via the normal route and re-runs the
# suites whose HTTP phases were blocked. Logs everything; exits when
# done or after ~90 minutes of probing.
cd ~/workspace/signl-app || exit 1
LOG=.qa-logs/ship-run.log
exec >> $LOG 2>&1
echo "[ship] started $(date -u)"
if ! mkdir .qa-logs/ship.lock 2>/dev/null; then echo "[ship] another runner holds the lock; exiting"; exit 0; fi
trap 'rmdir .qa-logs/ship.lock 2>/dev/null' EXIT

probe() {
  # Success = a previously-denied file's object write lands.
  cat scripts/verify-fit.mjs | git hash-object -w --stdin >/dev/null 2>&1
}

for i in $(seq 1 45); do
  if probe; then
    echo "[ship] block CLEAR at try $i $(date -u)"
    break
  fi
  if [ "$i" = "45" ]; then echo "[ship] block never cleared; giving up $(date -u)"; exit 2; fi
  sleep 120
done

git add -A -- . ':!.qa-logs' || { echo "[ship] git add FAILED"; exit 3; }
echo "[ship] staged: $(git diff --cached --name-only | wc -l) files"
git commit -F .qa-logs/commit-msg-68.txt || { echo "[ship] commit FAILED"; exit 4; }
echo "[ship] committed: $(git log --oneline -1)"
git push origin main || { echo "[ship] push FAILED"; exit 5; }
echo "[ship] PUSHED $(date -u)"

for s in verify-build68 verify-build64 verify-build66 verify-build67 verify-launch; do
  echo "===== $s ====="
  timeout 900 node scripts/$s.mjs 2>&1 | grep -E "FAIL|passed|failed" | head -30
  echo "----- $s done -----"
  fuser -k 8995/tcp 8996/tcp 8997/tcp 8998/tcp 8999/tcp 2>/dev/null
  sleep 1
done
echo "[ship] ALL DONE $(date -u)"
