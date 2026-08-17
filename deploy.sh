#!/usr/bin/env bash
# Start or stop Piano Trainer without a reverse proxy.
#
# Usage:
#   ./deploy.sh dev start|stop
#   ./deploy.sh prod start|stop

set -euo pipefail

MODE="${1:-}"
ACTION="${2:-}"
readonly DEV_PROCESS="piano-trainer-dev"
readonly PROD_PROCESS="piano-trainer-prod"
readonly APP_PORT=5173

usage() {
  echo "Usage: $0 {dev|prod} {start|stop}" >&2
  exit 64
}

[[ "$#" -eq 2 ]] || usage
[[ "$MODE" == "dev" || "$MODE" == "prod" ]] || usage
[[ "$ACTION" == "start" || "$ACTION" == "stop" ]] || usage

command -v pm2 >/dev/null || {
  echo "PM2 is required. Install it with: npm install -g pm2" >&2
  exit 1
}

is_known_to_pm2() {
  pm2 describe "$1" >/dev/null 2>&1
}

stop_process() {
  local process_name="$1"
  if is_known_to_pm2 "$process_name"; then
    pm2 stop "$process_name"
  else
    echo "$process_name is already stopped."
  fi
}

start_dev() {
  # Both modes use port 5173, so release it before starting Vite.
  stop_process "$PROD_PROCESS"

  if is_known_to_pm2 "$DEV_PROCESS"; then
    pm2 restart "$DEV_PROCESS" --update-env
  else
    pm2 start npm --name "$DEV_PROCESS" -- run dev -- --host 127.0.0.1 --port "$APP_PORT"
  fi

  echo "Development server: http://127.0.0.1:$APP_PORT/"
}

start_prod() {
  # The port is public and there is no proxy in front of it, so an unset
  # password means anyone who reaches it can read the practice history and
  # delete catalog entries. Warned about rather than enforced, so an existing
  # deployment can still be started while its owner picks a password.
  if [[ -z "${PIANO_TRAINER_PASSWORD:-}" ]]; then
    echo "WARNING: PIANO_TRAINER_PASSWORD is not set -- the API will be open to anyone who can reach port $APP_PORT." >&2
    echo "         Set it before starting: export PIANO_TRAINER_PASSWORD='...'" >&2
  fi

  # Deploy the checked-out branch as-is. A pull is deliberately not implicit:
  # it could overwrite or fail on local work on the VPS.
  npm ci
  npm run build

  # Both modes use port 5173, so release it before starting the public server.
  stop_process "$DEV_PROCESS"

  # --update-env re-reads this shell's environment on a restart, which is how
  # PIANO_TRAINER_PASSWORD reaches an already-known process.
  if is_known_to_pm2 "$PROD_PROCESS"; then
    PORT="$APP_PORT" pm2 restart "$PROD_PROCESS" --update-env
  else
    PORT="$APP_PORT" pm2 start npm --name "$PROD_PROCESS" -- start
  fi
  pm2 save

  # The public host lives in the environment, not in this (public) repository.
  echo "Production server: ${PIANO_TRAINER_PUBLIC_URL:-http://<vps-host>:$APP_PORT/}"
}

case "$MODE:$ACTION" in
  dev:start) start_dev ;;
  dev:stop) stop_process "$DEV_PROCESS" ;;
  prod:start) start_prod ;;
  prod:stop) stop_process "$PROD_PROCESS" ;;
esac
