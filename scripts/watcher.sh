#!/usr/bin/env bash
# Make It — Process watcher: auto-restart the Next.js dev server if it crashes.
# Polls port 3000 every 10s; if down, restarts `bun run dev`.
# Also ensures the realtime mini-service is up (port 3004).

set -u

cd /home/z/my-project

LOG="/home/z/my-project/dev.log"
REALTIME_LOG="/tmp/realtime.log"
PIDFILE="/tmp/makeit-watcher.pid"
echo $$ > "$PIDFILE"

start_dev() {
  echo "[watcher] $(date -Iseconds) starting Next.js dev server..." >> "$LOG"
  setsid nohup bun run dev >> "$LOG" 2>&1 < /dev/null &
}

start_realtime() {
  echo "[watcher] $(date -Iseconds) starting realtime mini-service..." >> "$REALTIME_LOG"
  cd /home/z/my-project/mini-services/realtime-service
  setsid nohup bun run dev >> "$REALTIME_LOG" 2>&1 < /dev/null &
  cd /home/z/my-project
}

is_port_open() {
  curl -s -o /dev/null -m 3 -w "%{http_code}" "http://localhost:$1$2" 2>/dev/null | grep -qE "^(200|302|307|401|403|404)$"
}

last_dev_check=0
last_realtime_check=0

while true; do
  now=$(date +%s)

  # Check Next.js dev server every 10s
  if [ $((now - last_dev_check)) -ge 10 ]; then
    last_dev_check=$now
    if ! is_port_open 3000 "/"; then
      if ! pgrep -f "next dev -p 3000" >/dev/null 2>&1; then
        echo "[watcher] $(date -Iseconds) Next.js dev server DOWN — restarting..." >> "$LOG"
        start_dev
        sleep 8
        if is_port_open 3000 "/"; then
          echo "[watcher] $(date -Iseconds) Next.js dev server RESTARTED OK" >> "$LOG"
        else
          echo "[watcher] $(date -Iseconds) Next.js dev server STILL DOWN after restart attempt" >> "$LOG"
        fi
      fi
    fi
  fi

  # Check realtime mini-service every 30s
  if [ $((now - last_realtime_check)) -ge 30 ]; then
    last_realtime_check=$now
    if ! is_port_open 3004 "/health"; then
      if ! pgrep -f "realtime-service" >/dev/null 2>&1; then
        echo "[watcher] $(date -Iseconds) realtime service DOWN — restarting..." >> "$REALTIME_LOG"
        start_realtime
        sleep 3
      fi
    fi
  fi

  sleep 5
done
