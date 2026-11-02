#!/bin/bash
# Guard-probe + suite runner: waits for the environment write guard to
# clear, then runs the -68-affected suites serially. Clean process tree:
# this script never loads app source except inside the disposable probe.
cd ~/workspace/signl-app
LOG=.qa-logs/guard-run.log
echo "[guard-runner] started $(date)" >> $LOG
for i in $(seq 1 40); do
  if node -e "const fs=require('fs'); require('./netlify/functions/lib/markets.js'); try{ fs.writeFileSync('/tmp/guardprobe2.tmp','{}'); fs.unlinkSync('/tmp/guardprobe2.tmp'); process.exit(0);}catch(e){ process.exit(1); }"; then
    echo "[guard-runner] GUARD CLEAR at $(date), running suites" >> $LOG
    for s in verify-build64 verify-build66 verify-build67 verify-build68 verify-sig verify-business verify-shell; do
      echo "===== $s =====" >> $LOG
      timeout 600 node scripts/$s.mjs >> $LOG 2>&1
      echo "----- $s exit=$? -----" >> $LOG
      fuser -k 8995/tcp 8996/tcp 8997/tcp 8998/tcp 8999/tcp 2>/dev/null
      sleep 1
    done
    echo "[guard-runner] DONE $(date)" >> $LOG
    exit 0
  fi
  sleep 90
done
echo "[guard-runner] guard never cleared $(date)" >> $LOG
