#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${APP_DIR}"

BRANCH="${1:-main}"
RELEASE_INPUT="${2:-${RELEASE_DIR:-}}"

if [[ -n "${RELEASE_INPUT}" && -d "${RELEASE_INPUT}" ]]; then
  bash "${APP_DIR}/deploy/ec2/apply-release.sh" "${RELEASE_INPUT}"
  exit 0
fi

echo "==> Redeploying Lesenpad backend on branch: ${BRANCH}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Installing via corepack..."
  corepack enable
  corepack prepare pnpm@10.17.1 --activate
fi

echo "==> Fetching latest code"
git fetch --all --prune
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

echo "==> Installing dependencies"
pnpm install --frozen-lockfile --prod=false

echo "==> Generating Prisma client"
pnpm prisma generate

echo "==> Running migrations"
pnpm prisma migrate deploy

echo "==> Building application"
pnpm run build

echo "==> Zero-downtime PM2 reload"
pm2 startOrReload ecosystem.config.js --env production --update-env
pm2 save

echo "==> Redeploy completed"
