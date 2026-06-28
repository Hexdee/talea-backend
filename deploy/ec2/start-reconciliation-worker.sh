#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/talea-backend}"
RELEASE_INPUT="${1:-${RELEASE_DIR:-}}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "APP_DIR does not exist: ${APP_DIR}" >&2
  exit 1
fi

cd "${APP_DIR}"

if [[ -n "${RELEASE_INPUT}" && -d "${RELEASE_INPUT}" ]]; then
  bash "${APP_DIR}/deploy/ec2/apply-release.sh" "${RELEASE_INPUT}"
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@10.17.1 --activate
fi

pnpm install --frozen-lockfile --prod=false
pnpm build
pm2 startOrReload ecosystem.config.js --only lesenpad-reconciliation-worker --env production --update-env
pm2 save
pm2 status lesenpad-reconciliation-worker
