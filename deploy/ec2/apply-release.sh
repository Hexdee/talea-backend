#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/lesenpad-backend}"
RELEASE_DIR="${1:-${RELEASE_DIR:-}}"

if [[ -z "${RELEASE_DIR}" ]]; then
  echo "Usage: $0 <release-dir>" >&2
  exit 1
fi

if [[ ! -d "${RELEASE_DIR}" ]]; then
  echo "Release directory does not exist: ${RELEASE_DIR}" >&2
  exit 1
fi

cd "${RELEASE_DIR}"

load_node_toolchain() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  for rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    if [[ -f "${rc}" ]]; then
      # shellcheck disable=SC1090
      source "${rc}"
    fi
  done

  if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "${NVM_DIR}/nvm.sh"
  fi
}

load_node_toolchain

pnpm_cmd() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@10.17.1 --activate
    pnpm "$@"
    return
  fi

  if command -v npm >/dev/null 2>&1; then
    npm exec --yes pnpm@10.17.1 -- "$@"
    return
  fi

  echo "pnpm, corepack, and npm are not available on this host" >&2
  exit 1
}

echo "==> Syncing release bundle into ${APP_DIR}"
mkdir -p "${APP_DIR}"
rm -rf "${APP_DIR}/dist" "${APP_DIR}/prisma" "${APP_DIR}/deploy" \
  "${APP_DIR}/package.json" "${APP_DIR}/pnpm-lock.yaml" \
  "${APP_DIR}/ecosystem.config.js" "${APP_DIR}/prisma.config.ts"

cp -R dist "${APP_DIR}/"
cp package.json "${APP_DIR}/"
cp pnpm-lock.yaml "${APP_DIR}/"
cp -R prisma "${APP_DIR}/"
cp -R deploy "${APP_DIR}/"
cp ecosystem.config.js "${APP_DIR}/"
cp prisma.config.ts "${APP_DIR}/"

cd "${APP_DIR}"

echo "==> Installing dependencies"
pnpm_cmd install --frozen-lockfile --prod=false

echo "==> Generating Prisma client"
pnpm_cmd prisma generate

echo "==> Running migrations"
pnpm_cmd prisma migrate deploy

echo "==> Reloading PM2 processes"
pm2 startOrReload ecosystem.config.js --env production --update-env
pm2 save
pm2 status lezenpad-backend
pm2 status lesenpad-reconciliation-worker
