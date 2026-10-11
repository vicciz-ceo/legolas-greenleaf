#!/bin/bash
# Machine-wide GPU queue for snapshots and smoke runs, so several agents (or terminals) never run
# more than SLOTS headless-Chromium renders at once on one machine (an 8 GB M3 struggles above 2).
#
#   scripts/gpu-queue.sh node scripts/snap.mjs "/?chapter=moria&cp=1&quality=medium&skipIntro=1&god=1&bot=1" --advance 6 --timeout 180000 --out shots/x.png
#   scripts/gpu-queue.sh npm run smoke -- --only moria
#
# Sets SNAP_GPU=1 (real GPU). Waits (polling every 3 s) until one of GPU_QUEUE_SLOTS (default 2) slots
# is free. Slots are lock directories under GPU_QUEUE_DIR (default ${TMPDIR:-/tmp}/greenleaf-gpu-queue);
# a slot whose owner process died is reclaimed automatically. Works from any worktree.
SLOTS=${GPU_QUEUE_SLOTS:-2}
DIR=${GPU_QUEUE_DIR:-${TMPDIR:-/tmp}/greenleaf-gpu-queue}
mkdir -p "$DIR"
waited=0
while true; do
  for i in $(seq 1 "$SLOTS"); do
    L="$DIR/slot$i"
    if mkdir "$L" 2>/dev/null; then
      echo $$ > "$L/pid"
      trap 'rm -rf "$L"' EXIT
      trap 'rm -rf "$L"; exit 130' INT TERM
      [ "$waited" -gt 0 ] && echo "[gpu-queue] waited ${waited}s for a GPU slot" >&2
      SNAP_GPU=1 "$@"
      exit $?
    fi
    p=$(cat "$L/pid" 2>/dev/null)
    if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then rm -rf "$L"; fi
  done
  sleep 3; waited=$((waited+3))
done
