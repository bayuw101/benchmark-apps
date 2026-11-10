#!/usr/bin/env bash
# Local development environment, one command. Idempotent: safe to run again at any time.
#
#   scripts/dev.sh up            everything: Compose + kind + migrations + seed + worker, then the web app on :3001
#   scripts/dev.sh up --ui-only  no kind or worker (UI work; runs queue but never start)
#   scripts/dev.sh up --no-web   set up only; start the web app yourself with pnpm dev
#   scripts/dev.sh status        what is up
#   scripts/dev.sh down          stop Compose (data kept); --wipe also deletes its volumes; --all also deletes kind
#
# Ctrl+C stops the web app only; the rest keeps running until 'down'.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f infra/local/docker-compose.yml)
WEB_PORT=3001

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing required tool: $1 ($2)" >&2; exit 1; }; }

up() {
  local ui_only=false web=true
  for a in "$@"; do
    case "$a" in
      --ui-only) ui_only=true ;;
      --no-web) web=false ;;
      --) ;;
      *) echo "unknown option: $a" >&2; exit 1 ;;
    esac
  done

  need node "Node 22+"; need pnpm "corepack enable"; need docker "Docker Engine or Desktop"
  [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]] || { echo "Node 22+ required" >&2; exit 1; }
  $ui_only || { need kind "https://kind.sigs.k8s.io"; need kubectl "https://kubernetes.io/docs/tasks/tools/"; }

  step "Dependencies"
  pnpm install --frozen-lockfile
  [[ -f apps/web/.env.local ]] || { cp apps/web/.env.example apps/web/.env.local; echo "created apps/web/.env.local"; }

  step "Compose stack (Postgres, Redis, RedisInsight, MinIO, mock target)"
  # --remove-orphans: drops containers of services no longer in the file (e.g. the old Compose Prometheus).
  "${COMPOSE[@]}" up -d --build --remove-orphans
  for _ in $(seq 1 60); do
    "${COMPOSE[@]}" exec -T postgres pg_isready -q && break
    sleep 1
  done

  if $ui_only; then
    step "Runner catalog (no image: --ui-only)"
    pnpm catalog:build
  else
    step "kind cluster (first run takes a few minutes)"
    infra/kind/up.sh
  fi

  step "Database: migrations + dev data"
  pnpm db:migrate
  pnpm db:seed
  pnpm db:seed:runs

  if ! $ui_only; then
    step "Worker"
    "${COMPOSE[@]}" --profile worker up -d --build worker
  fi

  if $ui_only; then echo "UI only: runs can be created and approved, but nothing executes them. 'pnpm dev:up' starts the full stack."; fi
  if ! $web; then
    echo "Ready. Start the web app: pnpm dev  ->  http://localhost:${WEB_PORT}"
  elif web_up; then
    echo "Ready. The web app is already running: http://localhost:${WEB_PORT}"
  else
    step "Web app on http://localhost:${WEB_PORT} (Ctrl+C stops it; the rest keeps running, 'pnpm dev:down' stops that)"
    echo "Sign in with any dev account on the login page."
    exec pnpm --filter @btb/web dev
  fi
}

web_up() { curl -s -o /dev/null --max-time 2 "http://localhost:${WEB_PORT}/login"; }

status() {
  "${COMPOSE[@]}" --profile worker --profile grafana ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
  if command -v kind >/dev/null && kind get clusters 2>/dev/null | grep -qx btb; then echo "kind: cluster btb is up"; else echo "kind: no cluster"; fi
  if web_up; then echo "web: http://localhost:${WEB_PORT}"; else echo "web: not running (pnpm dev)"; fi
}

down() {
  local wipe=() all=false
  for a in "$@"; do
    case "$a" in
      --wipe) wipe=(-v) ;;
      --all) all=true ;;
      --) ;;
      *) echo "unknown option: $a" >&2; exit 1 ;;
    esac
  done
  "${COMPOSE[@]}" --profile worker --profile grafana down ${wipe[@]+"${wipe[@]}"}
  if $all; then infra/kind/down.sh; fi
}

cmd="${1:-}"
shift || true
case "$cmd" in
  up) up "$@" ;;
  status) status ;;
  down) down "$@" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
