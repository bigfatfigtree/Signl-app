#!/bin/bash
cd ~/workspace/signl-app
OUT=.qa138/sweep-final.txt
: > "$OUT"
for f in scripts/verify-*.mjs; do
  name=$(basename "$f" .mjs)
  res=$(timeout 120 node "$f" 2>&1 | tail -3 | tr '\n' ' ')
  code=$?
  echo "$name | exit=$code | $res" >> "$OUT"
done
echo "SWEEP DONE" >> "$OUT"
