#!/usr/bin/env bash
# Store screenshots of the lens from the Even Hub simulator, one per dev fixture (app/src/lens/fixtures.ts).
#
#   scripts/sim-shots.sh              # every fixture
#   scripts/sim-shots.sh peek card    # just these
#
# Needs: `evenhub-simulator` on PATH (npm i -g @evenrealities/evenhub-simulator, tested with v0.9.5), curl,
# and a desktop session (the simulator opens a window; it does not run headless).
#
# How: starts `npx vite --port 5180` in app/ (fixtures only exist under `vite` dev, never in a build) and
# launches the simulator ONCE on http://localhost:5180/?fixture=remote with its automation server on 9898.
# For each fixture it POSTs /__fixture?want=<name> to the dev server (vite.config.ts), waits until the
# page reports it painted, settles, then saves GET /api/screenshot/glasses to
# docs/store/screenshots/<nn>-<name>.png. At the end the simulator gets SIGTERM (never SIGKILL).
# If the simulator dies on launch, its RUST_LOG=info output is printed; at most 2 launch attempts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
OUT="$ROOT/docs/store/screenshots"
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/sim-shots.XXXXXX")"
VITE_PORT=5180
AUTO_PORT=9898
DEV="http://localhost:$VITE_PORT"
SIM="http://localhost:$AUTO_PORT"
SETTLE_S="${SETTLE_S:-2}"          # after the page reports the fixture painted
BOOT_SETTLE_S="${BOOT_SETTLE_S:-5}" # after /api/ping first answers
READY_TIMEOUT_S="${READY_TIMEOUT_S:-60}"
MAX_LAUNCHES=2
ALL=(home lobby planning planResult peek banner card answer brief wrapup)
if [ "$#" -gt 0 ]; then FIXTURES=("$@"); else FIXTURES=("${ALL[@]}"); fi

command -v evenhub-simulator >/dev/null || { echo "evenhub-simulator not found (npm i -g @evenrealities/evenhub-simulator)" >&2; exit 1; }
if curl -fsS -o /dev/null "$SIM/api/ping" 2>/dev/null; then
  echo "Something already answers on :$AUTO_PORT (another simulator?). Quit it first; this script won't kill it." >&2
  exit 1
fi
mkdir -p "$OUT"

VITE_PID=""
SIM_PID=""
# Graceful quit: SIGTERM, then wait up to 10 s. Never SIGKILL the simulator (that leaves crash dialogs).
# The global `evenhub-simulator` is a node shim that spawns the native binary: SIGTERM the binary (its
# children) first, then the shim, and wait for the automation port to close.
stop_sim() {
  [ -n "$SIM_PID" ] || return 0
  local kids
  kids="$(pgrep -P "$SIM_PID" 2>/dev/null || true)"
  [ -n "$kids" ] && kill -TERM $kids 2>/dev/null || true
  kill -TERM "$SIM_PID" 2>/dev/null || true
  for _ in $(seq 1 20); do
    alive=""
    for p in "$SIM_PID" $kids; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ -z "$alive" ] && ! curl -fsS -o /dev/null "$SIM/api/ping" 2>/dev/null && break
    sleep 0.5
  done
  for p in "$SIM_PID" $kids; do kill -0 "$p" 2>/dev/null && echo "Simulator process $p is still running after SIGTERM; quit it by hand." >&2; done
  SIM_PID=""
}
cleanup() {
  stop_sim
  [ -n "$VITE_PID" ] && kill -TERM "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# wait_for <url> <seconds> [pid]: poll until the URL answers 2xx; fails early if <pid> exits.
wait_for() {
  local url="$1" limit="$2" pid="${3:-}" i=0
  until curl -fsS -o /dev/null "$url" 2>/dev/null; do
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then return 2; fi
    i=$((i + 1))
    if [ "$i" -ge "$((limit * 2))" ]; then return 1; fi
    sleep 0.5
  done
}

echo "Starting vite on :$VITE_PORT"
(cd "$APP" && exec npx vite --port "$VITE_PORT" --strictPort) >"$LOGS/vite.log" 2>&1 &
VITE_PID=$!
wait_for "$DEV/__fixture" 60 "$VITE_PID" || { echo "vite did not start (see $LOGS/vite.log)" >&2; exit 1; }
curl -fsS -X POST "$DEV/__fixture?want=${FIXTURES[0]}" -o /dev/null

launched=""
for attempt in $(seq 1 "$MAX_LAUNCHES"); do
  log="$LOGS/sim-$attempt.log"
  echo "Launching simulator (attempt $attempt/$MAX_LAUNCHES, log: $log)"
  RUST_LOG=info evenhub-simulator "$DEV/?fixture=remote" --automation-port "$AUTO_PORT" >"$log" 2>&1 &
  SIM_PID=$!
  rc=0; wait_for "$SIM/api/ping" "$READY_TIMEOUT_S" "$SIM_PID" || rc=$?
  if [ "$rc" -eq 0 ]; then launched=1; break; fi
  if [ "$rc" -eq 2 ]; then
    wait "$SIM_PID" 2>/dev/null && code=0 || code=$?
    echo "Simulator exited during launch (exit code $code). Last log lines:" >&2
  else
    echo "Simulator never answered $SIM/api/ping within ${READY_TIMEOUT_S}s. Last log lines:" >&2
  fi
  tail -n 40 "$log" >&2
  stop_sim
done
[ -n "$launched" ] || { echo "Giving up after $MAX_LAUNCHES launch attempts (logs in $LOGS)." >&2; exit 1; }
sleep "$BOOT_SETTLE_S"

failed=()
for name in "${FIXTURES[@]}"; do
  idx=0
  for i in "${!ALL[@]}"; do [ "${ALL[$i]}" = "$name" ] && idx=$((i + 1)); done
  [ "$idx" -gt 0 ] || { echo "[$name] unknown fixture (have: ${ALL[*]})" >&2; failed+=("$name"); continue; }
  file="$OUT/$(printf '%02d' "$idx")-$name.png"
  kill -0 "$SIM_PID" 2>/dev/null || { echo "Simulator exited mid-run. Last log lines:" >&2; tail -n 40 "$LOGS"/sim-*.log >&2; exit 1; }
  curl -fsS -X POST "$DEV/__fixture?want=$name" -o /dev/null
  shown=""
  for _ in $(seq 1 40); do
    if curl -fsS "$DEV/__fixture" 2>/dev/null | grep -q "\"shown\":\"$name\""; then shown=1; break; fi
    sleep 0.5
  done
  if [ -z "$shown" ]; then echo "[$name] the page never reported it painted" >&2; failed+=("$name"); continue; fi
  sleep "$SETTLE_S"
  if curl -fsS "$SIM/api/screenshot/glasses" -o "$file"; then echo "[$name] saved $file"; else echo "[$name] screenshot request failed" >&2; failed+=("$name"); fi
done

stop_sim
if [ "${#failed[@]}" -gt 0 ]; then echo "Failed: ${failed[*]} (logs in $LOGS)" >&2; exit 1; fi
echo "Done: ${#FIXTURES[@]} screenshot(s) in $OUT"
