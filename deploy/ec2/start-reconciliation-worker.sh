#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/talea-backend}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "APP_DIR does not exist: ${APP_DIR}" >&2
  exit 1
fi

cd "${APP_DIR}"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@10.17.1 --activate
fi

pnpm install --frozen-lockfile --prod=false
pnpm build
pm2 startOrReload ecosystem.config.js --only lesenpad-reconciliation-worker --env production --update-env
pm2 save
pm2 status lesenpad-reconciliation-worker
