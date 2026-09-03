#!/usr/bin/env bash
# Local Postgres 17 without Docker (D-139): portable PostgreSQL binaries under ~/.tassl-tools.
# Equivalent to `docker compose up -d --wait` / `docker compose down` from compose.yaml.
#
#   bash scripts/pg-local.sh start     # start the cluster on :5432 and ensure tassl + tassl_test exist
#   bash scripts/pg-local.sh stop
#   bash scripts/pg-local.sh restart
#   bash scripts/pg-local.sh status    # exit 0 when the server accepts connections
#
# Layout (created once, see docs/tech/DECISIONS.md D-139):
#   $TASSL_TOOLS_DIR/pgsql   PostgreSQL 17.x binaries
#   $TASSL_TOOLS_DIR/pgdata  cluster, superuser tassl / password tassl
#   $TASSL_TOOLS_DIR/pg.log  server log
set -euo pipefail

TOOLS="${TASSL_TOOLS_DIR:-$HOME/.tassl-tools}"
PGBIN="$TOOLS/pgsql/bin"
PGDATA="$TOOLS/pgdata"
PGLOG="$TOOLS/pg.log"
PGPORT="${PGPORT:-5432}"
export PGPASSWORD="${PGPASSWORD:-tassl}"

if [ ! -x "$PGBIN/pg_ctl" ] && [ ! -x "$PGBIN/pg_ctl.exe" ]; then
  echo "pg-local: PostgreSQL binaries not found in $PGBIN (see DECISIONS.md D-139)" >&2
  exit 1
fi

running() { "$PGBIN/pg_ctl" -D "$PGDATA" status > /dev/null 2>&1; }

wait_ready() {
  for _ in $(seq 1 30); do
    if "$PGBIN/pg_isready" -h localhost -p "$PGPORT" -U tassl -d tassl > /dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "pg-local: server did not become ready on port $PGPORT (see $PGLOG)" >&2
  return 1
}

ensure_databases() {
  for db in tassl tassl_test; do
    if ! "$PGBIN/psql" -h localhost -p "$PGPORT" -U tassl -d postgres -tAc \
      "select 1 from pg_database where datname = '$db'" | grep -qx 1; then
      "$PGBIN/createdb" -h localhost -p "$PGPORT" -U tassl -O tassl "$db"
      echo "pg-local: created database $db"
    fi
  done
}

start() {
  if running; then
    echo "pg-local: already running"
  else
    # All three descriptors are redirected so the server never inherits the caller's terminal.
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" -o "-p $PGPORT" -w start > /dev/null 2>&1 < /dev/null
    echo "pg-local: started (log: $PGLOG)"
  fi
  wait_ready
  ensure_databases
}

stop() {
  if running; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop > /dev/null 2>&1 < /dev/null
    echo "pg-local: stopped"
  else
    echo "pg-local: not running"
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart)
    stop
    start
    ;;
  status)
    if running && "$PGBIN/pg_isready" -h localhost -p "$PGPORT" -U tassl -d tassl; then exit 0; fi
    echo "pg-local: not running"
    exit 1
    ;;
  *)
    echo "usage: bash scripts/pg-local.sh start|stop|restart|status" >&2
    exit 2
    ;;
esac
