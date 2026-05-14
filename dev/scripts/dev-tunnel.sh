#!/usr/bin/env bash
# dev-tunnel.sh — replace the broken `code tunnel` Forward Port button.
#
# Starts uvicorn locally, opens a reverse tunnel to a public host
# (localhost.run by default, or cloudflared if USE_CLOUDFLARED=1), and
# prints the resulting public URL. Ctrl+C kills both processes.
#
# Usage:
#   ./scripts/dev-tunnel.sh                 # uvicorn :8800 + ssh -R to lhr.life
#   PORT=18800 ./scripts/dev-tunnel.sh
#   USE_CLOUDFLARED=1 ./scripts/dev-tunnel.sh
#   TUNNEL_HOST=serveo.net ./scripts/dev-tunnel.sh
#
# Required commands: python3, uvicorn (pip install), ssh OR /tmp/cloudflared.
# No accounts. No VSCode. No DSW gateway auth.

set -u
set -o pipefail

# ── config ───────────────────────────────────────────────────────────────
PORT="${PORT:-8800}"
TUNNEL_HOST="${TUNNEL_HOST:-localhost.run}"
USE_CLOUDFLARED="${USE_CLOUDFLARED:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${LOG_DIR:-/tmp/msve-tunnel-$$}"
mkdir -p "$LOG_DIR"
UVI_LOG="$LOG_DIR/uvicorn.log"
TUN_LOG="$LOG_DIR/tunnel.log"

UVI_PID=""
TUN_PID=""

# ── cleanup ──────────────────────────────────────────────────────────────
cleanup() {
  echo
  echo "[dev-tunnel] cleaning up..."
  [[ -n "$TUN_PID" ]] && kill "$TUN_PID" 2>/dev/null && wait "$TUN_PID" 2>/dev/null || true
  [[ -n "$UVI_PID" ]] && kill "$UVI_PID" 2>/dev/null && wait "$UVI_PID" 2>/dev/null || true
  echo "[dev-tunnel] logs preserved at: $LOG_DIR"
  exit 0
}
trap cleanup INT TERM

# ── helpers ──────────────────────────────────────────────────────────────
banner() {
  echo
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════════════════════════"
}

# ── 1. start uvicorn ─────────────────────────────────────────────────────
banner "[1/3] starting uvicorn on port $PORT (app-dir: $APP_DIR)"
cd "$APP_DIR"

DEMO_PUBLIC_BASE_URL="${DEMO_PUBLIC_BASE_URL:-http://127.0.0.1:$PORT}" \
DEMO_RUNS_ROOT="${DEMO_RUNS_ROOT:-/tmp/msve-dev-runs}" \
DEMO_SKIP_HEALTHCHECK="${DEMO_SKIP_HEALTHCHECK:-1}" \
  python3 -m uvicorn server:app --app-dir . --host 0.0.0.0 --port "$PORT" \
  > "$UVI_LOG" 2>&1 &
UVI_PID=$!
echo "[dev-tunnel] uvicorn pid=$UVI_PID log=$UVI_LOG"

# ── 2. wait for uvicorn ──────────────────────────────────────────────────
banner "[2/3] waiting for uvicorn to accept requests..."
for attempt in $(seq 1 30); do
  if curl -sf -m 2 "http://127.0.0.1:$PORT/api/healthcheck" > /dev/null 2>&1; then
    echo "[dev-tunnel] uvicorn is up after ${attempt}s"
    break
  fi
  if ! kill -0 "$UVI_PID" 2>/dev/null; then
    echo "[dev-tunnel] uvicorn died early. Last 20 lines of log:" >&2
    tail -20 "$UVI_LOG" >&2
    cleanup
  fi
  sleep 1
done
if ! curl -sf -m 2 "http://127.0.0.1:$PORT/api/healthcheck" > /dev/null 2>&1; then
  echo "[dev-tunnel] uvicorn never responded. Last 30 lines:" >&2
  tail -30 "$UVI_LOG" >&2
  cleanup
fi

# ── 3. open reverse tunnel ───────────────────────────────────────────────
URL=""

if [[ "$USE_CLOUDFLARED" == "1" ]]; then
  banner "[3/3] starting cloudflared tunnel..."
  if [[ ! -x /tmp/cloudflared ]]; then
    echo "[dev-tunnel] /tmp/cloudflared not found, downloading..."
    curl -L --fail --max-time 60 \
      -o /tmp/cloudflared \
      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
      || { echo "[dev-tunnel] cloudflared download failed" >&2; cleanup; }
    chmod +x /tmp/cloudflared
  fi
  /tmp/cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" \
    > "$TUN_LOG" 2>&1 &
  TUN_PID=$!
  echo "[dev-tunnel] cloudflared pid=$TUN_PID log=$TUN_LOG"

  for attempt in $(seq 1 30); do
    sleep 1
    URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUN_LOG" | head -1 || true)"
    [[ -n "$URL" ]] && break
    if ! kill -0 "$TUN_PID" 2>/dev/null; then
      echo "[dev-tunnel] cloudflared died. Log:" >&2
      tail -20 "$TUN_LOG" >&2
      cleanup
    fi
  done
else
  banner "[3/3] opening SSH reverse tunnel to $TUNNEL_HOST..."
  # localhost.run + serveo.net + pinggy.io all accept the same shape:
  #   ssh -R 80:localhost:PORT <user>@<host>
  SSH_USER="nokey"
  SSH_PORT=22
  case "$TUNNEL_HOST" in
    serveo.net)
      SSH_USER=""
      ;;
    a.pinggy.io|pinggy.io)
      SSH_PORT=443
      ;;
  esac
  SSH_TARGET="${SSH_USER:+$SSH_USER@}$TUNNEL_HOST"
  ssh -o StrictHostKeyChecking=no \
      -o IdentitiesOnly=yes \
      -o ServerAliveInterval=30 \
      -i /dev/null \
      -p "$SSH_PORT" \
      -R "80:localhost:$PORT" "$SSH_TARGET" \
      > "$TUN_LOG" 2>&1 &
  TUN_PID=$!
  echo "[dev-tunnel] ssh pid=$TUN_PID log=$TUN_LOG"

  for attempt in $(seq 1 20); do
    sleep 1
    URL="$(grep -oE 'https://[a-z0-9-]+\.(lhr\.life|serveo\.net|pinggy\.link|free\.pinggy\.online|trycloudflare\.com)' "$TUN_LOG" | head -1 || true)"
    [[ -n "$URL" ]] && break
    if ! kill -0 "$TUN_PID" 2>/dev/null; then
      echo "[dev-tunnel] ssh tunnel died early. Log:" >&2
      tail -30 "$TUN_LOG" >&2
      echo
      echo "[dev-tunnel] tip: this host may block outbound SSH to port 22." >&2
      echo "[dev-tunnel]   retry with cloudflared: USE_CLOUDFLARED=1 $0" >&2
      cleanup
    fi
  done
fi

if [[ -z "$URL" ]]; then
  echo "[dev-tunnel] could not extract URL from tunnel log. Last 30 lines:" >&2
  tail -30 "$TUN_LOG" >&2
  cleanup
fi

# ── ready ────────────────────────────────────────────────────────────────
banner "ready"
echo
echo "  ✓ Open in your browser:"
echo
echo "      $URL"
echo
echo "  uvicorn  pid=$UVI_PID   log=$UVI_LOG"
echo "  tunnel   pid=$TUN_PID   log=$TUN_LOG"
echo
echo "  press Ctrl+C to stop both."
echo "═══════════════════════════════════════════════════════════════════"
echo

# Hold until either child dies or user hits Ctrl+C.
wait -n "$UVI_PID" "$TUN_PID" || true
echo "[dev-tunnel] a child process exited unexpectedly."
cleanup
