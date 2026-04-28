#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${APP_DIR}"

echo "==> Deploying Lesenpad backend from ${APP_DIR}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Installing via corepack..."
  corepack enable
  corepack prepare pnpm@10.17.1 --activate
fi

echo "==> Installing dependencies"
pnpm install --frozen-lockfile --prod=false

echo "==> Generating Prisma client"
pnpm prisma generate

echo "==> Running migrations"
pnpm prisma migrate deploy

echo "==> Building application"
pnpm run build

echo "==> Starting or reloading PM2 app"
pm2 startOrReload ecosystem.config.js --env production --update-env

echo "==> Ensuring PM2 logrotate module is installed"
if ! pm2 module:list | grep -q "pm2-logrotate"; then
  pm2 install pm2-logrotate
fi

echo "==> Configuring PM2 logrotate"
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
pm2 set pm2-logrotate:workerInterval 30

echo "==> Persisting PM2 process list"
pm2 save

echo "==> Deployment completed"
